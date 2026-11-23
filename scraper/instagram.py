"""Instagram metrics via the official Instagram Graph API (Meta). No scraping, no login session.

Needs an Instagram *Business or Creator* account linked to a Facebook Page, and a Meta app:
    IG_GRAPH_TOKEN      long-lived access token (permissions: instagram_basic, pages_show_list,
                        pages_read_engagement, instagram_manage_insights)
    IG_USER_ID          the Instagram Business Account id that owns the token
    GRAPH_API_VERSION   optional, default v23.0

What the API can return, by whose post it is:
  * your OWN account's posts:   likes, comments, plus insights (views, shares, reach, saves)
  * OTHER business/creator accounts' public posts (Business Discovery): likes and comments only,
    found by scanning that account's recent media (up to 500 posts) for the post's shortcode.
Personal (non business/creator) accounts cannot be read through the Graph API at all.
"""
import os
import re
from typing import Any, Dict, Optional

import requests

_URL_RE = re.compile(r"instagram\.com/(?:[\w.]+/)?(?:p|reel|tv|reels)/([A-Za-z0-9_\-]+)")
MEDIA_FIELDS = "id,shortcode,permalink,like_count,comments_count,media_type,media_product_type,timestamp,caption,username"
MAX_PAGES = 10          # business discovery: pages of 50 posts scanned per account
RATE_CODES = {4, 17, 32, 613, 80001, 80002, 80003, 80004, 80005, 80006}


class AuthError(Exception):
    """Token missing, expired or lacking permissions - needs a human to fix it."""


class RateLimited(Exception):
    """Meta says slow down. Stop sending requests for this run."""


def parse_url(url: str) -> Optional[str]:
    m = _URL_RE.search(url)
    return m.group(1) if m else None


# ------------------------------------------------------------------ plumbing
def _creds() -> tuple:
    token, uid = os.environ.get("IG_GRAPH_TOKEN"), os.environ.get("IG_USER_ID")
    if not token or not uid:
        raise AuthError("IG_GRAPH_TOKEN and IG_USER_ID are not set")
    return token, uid


def _get(path: str, **params: Any) -> Dict[str, Any]:
    token, _ = _creds()
    ver = os.environ.get("GRAPH_API_VERSION", "v23.0")
    r = requests.get(f"https://graph.facebook.com/{ver}/{path.lstrip('/')}", params={**params, "access_token": token}, timeout=30)
    try:
        data = r.json()
    except ValueError:
        raise RuntimeError(f"Graph API returned non-JSON (HTTP {r.status_code})")
    err = data.get("error") if isinstance(data, dict) else None
    if err:
        code, sub, msg = err.get("code"), err.get("error_subcode"), err.get("message", "")
        if code in RATE_CODES:
            raise RateLimited(f"Instagram Graph API rate limit (code {code}): {msg[:120]}")
        if code == 190 or code in (10, 200, 299):
            raise AuthError(f"Instagram Graph token problem (code {code}): {msg[:160]}")
        raise RuntimeError(f"Graph API error {code}{'/' + str(sub) if sub else ''}: {msg[:200]}")
    if r.status_code >= 400:
        raise RuntimeError(f"Graph API HTTP {r.status_code}")
    return data


# ------------------------------------------------------------------ own account
_own: Optional[Dict[str, Dict[str, Any]]] = None
_own_username: Optional[str] = None


def _own_media() -> Dict[str, Dict[str, Any]]:
    """shortcode -> media, for the connected account (cached for the run)."""
    global _own, _own_username
    if _own is not None:
        return _own
    _, uid = _creds()
    out: Dict[str, Dict[str, Any]] = {}
    me = _get(uid, fields="username")
    _own_username = (me.get("username") or "").lower()
    data = _get(f"{uid}/media", fields=MEDIA_FIELDS, limit=100)
    for _ in range(20):
        for m in data.get("data", []):
            code = m.get("shortcode") or parse_url(m.get("permalink", "") or "")
            if code:
                out[code] = m
        nxt = (data.get("paging") or {}).get("cursors", {}).get("after")
        if not nxt or not data.get("data"):
            break
        data = _get(f"{uid}/media", fields=MEDIA_FIELDS, limit=100, after=nxt)
    _own = out
    return out


def _insights(media: Dict[str, Any]) -> Dict[str, Optional[int]]:
    """views / shares / reach / saves for one of your own posts. Metrics differ by post type, so try sets."""
    for metrics in ("views,shares,reach,saved", "views,reach", "plays,shares,reach,saved", "impressions,reach"):
        try:
            data = _get(f"{media['id']}/insights", metric=metrics)
        except RuntimeError:
            continue
        out: Dict[str, Optional[int]] = {}
        for item in data.get("data", []):
            vals = item.get("values") or [{}]
            out[item.get("name", "")] = vals[0].get("value")
        views = out.get("views") if out.get("views") is not None else out.get("plays", out.get("impressions"))
        return {"views": views, "shares": out.get("shares"), "reach": out.get("reach"), "saves": out.get("saved")}
    return {"views": None, "shares": None, "reach": None, "saves": None}


# ------------------------------------------------------------ other accounts
_discovery: Dict[str, Dict[str, Any]] = {}


def _business_discovery(username: str, find: Optional[str] = None) -> Dict[str, Any]:
    """Public data of another business/creator account. Scans its media for shortcode `find`."""
    _, uid = _creds()
    u = username.lstrip("@").lower()
    cache = _discovery.setdefault(u, {"media": {}, "profile": None, "done": False, "after": None, "pages": 0})
    while True:
        if find and find in cache["media"]:
            return cache
        if cache["done"] and cache["profile"] is not None:
            return cache
        media_part = f"media.limit(50){{{MEDIA_FIELDS}}}" if not cache["after"] else f"media.after({cache['after']}).limit(50){{{MEDIA_FIELDS}}}"
        fields = f"business_discovery.username({u}){{username,followers_count,follows_count,media_count,{media_part}}}"
        try:
            data = _get(uid, fields=fields)
        except RuntimeError as exc:
            text = str(exc).lower()
            if any(k in text for k in ("cannot find", "does not exist", "business or creator", "unsupported", "invalid user")):
                raise RuntimeError(f"@{u} is not readable through the Graph API (it must be a public Business or Creator account)")
            raise
        bd = data.get("business_discovery") or {}
        if cache["profile"] is None:
            cache["profile"] = {"followers": bd.get("followers_count"), "following": bd.get("follows_count"), "posts_count": bd.get("media_count")}
        media = bd.get("media") or {}
        for m in media.get("data", []):
            code = m.get("shortcode") or parse_url(m.get("permalink", "") or "")
            if code:
                cache["media"][code] = m
        cache["after"] = (media.get("paging") or {}).get("cursors", {}).get("after")
        cache["pages"] += 1
        if not cache["after"] or not media.get("data") or cache["pages"] >= MAX_PAGES:
            cache["done"] = True
        if not find:
            return cache


def _username_for(shortcode: str, post: Optional[dict]) -> Optional[str]:
    name = ((post or {}).get("author") or "").strip().lstrip("@")
    if name:
        return name
    url = (post or {}).get("url") or f"https://www.instagram.com/p/{shortcode}/"
    try:  # oEmbed tells us who owns a public post
        return _get("instagram_oembed", url=url, fields="author_name").get("author_name")
    except RuntimeError:
        return None


# ------------------------------------------------------------------- public API
def fetch_post(shortcode: str, post: Optional[dict] = None) -> Dict[str, Any]:
    own = _own_media().get(shortcode)
    if own:
        ins = _insights(own)
        return {
            "likes": own.get("like_count"),
            "comments": own.get("comments_count"),
            "views": ins["views"],
            "shares": ins["shares"],
            "author": own.get("username") or _own_username,
            "title": (own.get("caption") or "")[:80] or None,
        }

    username = _username_for(shortcode, post)
    if not username:
        raise RuntimeError("cannot tell which account owns this post - set the creator name for it, or connect the owner's account")
    cache = _business_discovery(username, find=shortcode)
    m = cache["media"].get(shortcode)
    if not m:
        raise RuntimeError(f"post not found in @{username}'s recent {MAX_PAGES * 50} posts (deleted, too old, or the account is not a Business/Creator account)")
    return {
        "likes": m.get("like_count"),
        "comments": m.get("comments_count"),
        "views": None,   # the Graph API does not expose other accounts' view counts
        "shares": None,
        "author": m.get("username") or username,
        "title": (m.get("caption") or "")[:80] or None,
    }


def fetch_profile(handle: str) -> Dict[str, Any]:
    _, uid = _creds()
    own = _get(uid, fields="username,followers_count,follows_count,media_count")
    if (own.get("username") or "").lower() == handle.lstrip("@").lower():
        return {"followers": own.get("followers_count"), "following": own.get("follows_count"), "posts_count": own.get("media_count")}
    prof = _business_discovery(handle)["profile"] or {}
    if prof.get("followers") is None:
        raise RuntimeError(f"@{handle} is not readable through the Graph API (it must be a public Business or Creator account)")
    return prof


def reset_cache() -> None:  # used by tests
    global _own, _own_username
    _own, _own_username = None, None
    _discovery.clear()
