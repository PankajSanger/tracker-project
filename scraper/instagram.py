"""Instagram via Apify actors (no browser, no login).

posts:    apify/instagram-scraper          -> likesCount, commentsCount, videoPlayCount (reel views), owner, caption
profiles: apify/instagram-profile-scraper  -> followersCount, followsCount, postsCount
Shares are not exposed by Instagram, so they stay empty.
"""
import re
from typing import Any, Dict, List, Optional

from apify_api import run_actor

POST_ACTOR = "apify/instagram-scraper"
PROFILE_ACTOR = "apify/instagram-profile-scraper"
_URL_RE = re.compile(r"instagram\.com/(?:[\w.]+/)?(?:p|reel|tv|reels)/([A-Za-z0-9_\-]+)")


def parse_url(url: str) -> Optional[str]:
    m = _URL_RE.search(url)
    return m.group(1) if m else None


def _count(v: Any) -> Optional[int]:
    return int(v) if isinstance(v, (int, float)) and v >= 0 else None  # Instagram sends -1 when likes are hidden


def _item_error(item: Dict[str, Any]) -> Optional[Exception]:
    err = item.get("error")
    if not err:
        return None
    desc = item.get("errorDescription") or err
    if any(k in str(err).lower() for k in ("not_found", "private", "restricted", "no_items")):
        return RuntimeError(f"post unavailable (deleted or private): {desc}")
    return RuntimeError(f"Apify could not read this post: {desc}")


def map_post(item: Dict[str, Any]) -> Dict[str, Any]:
    views = item.get("videoPlayCount")
    if views is None:
        views = item.get("videoViewCount")
    return {
        "likes": _count(item.get("likesCount")),
        "comments": _count(item.get("commentsCount")),
        "views": _count(views),
        "shares": None,
        "author": item.get("ownerUsername"),
        "title": ((item.get("caption") or "").replace("\n", " ")[:80]) or None,
    }


def fetch_posts(codes: List[str]) -> Dict[str, Any]:
    """{shortcode: data dict | Exception} for every requested shortcode (one Apify run)."""
    items = run_actor(POST_ACTOR, {
        "directUrls": [f"https://www.instagram.com/p/{c}/" for c in codes],
        "resultsType": "posts", "resultsLimit": 1, "addParentData": False,
    })
    out: Dict[str, Any] = {}
    for it in items:
        code = it.get("shortCode") or parse_url(it.get("url") or "") or parse_url(it.get("inputUrl") or "")
        if code in codes and code not in out:
            out[code] = _item_error(it) or map_post(it)
    for c in codes:
        out.setdefault(c, RuntimeError("post unavailable (Apify returned nothing - deleted or private?)"))
    return out


def map_profile(item: Dict[str, Any]) -> Dict[str, Any]:
    return {"followers": _count(item.get("followersCount")), "following": _count(item.get("followsCount")),
            "posts_count": _count(item.get("postsCount"))}


def fetch_profiles(handles: List[str]) -> Dict[str, Any]:
    names = [h.lstrip("@") for h in handles]
    items = run_actor(PROFILE_ACTOR, {"usernames": names})
    by_name = {(it.get("username") or "").lower(): it for it in items if it.get("username")}
    out: Dict[str, Any] = {}
    for h, n in zip(handles, names):
        it = by_name.get(n.lower())
        out[h] = map_profile(it) if it and it.get("followersCount") is not None else RuntimeError("profile not found or private")
    return out
