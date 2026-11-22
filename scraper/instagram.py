"""Instagram scraping via the internal media-info API (no browser needed).

Requires a logged-in session cookie in env IG_SESSIONID. Anonymous requests
from datacenter IPs (GitHub Actions) are blocked by Instagram.
"""
import os
import re
from typing import Any, Dict, Optional

import requests

_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
_URL_RE = re.compile(r"instagram\.com/(?:[\w.]+/)?(?:p|reel|tv|reels)/([A-Za-z0-9_\-]+)")

HEADERS = {
    "User-Agent": (
        "Instagram 319.0.0.0.0 Android (26/8.0.0; 480dpi; 1080x1920; "
        "Samsung; SM-G991B; samsung; exynos2100; en_US; 314665256)"
    ),
    "X-IG-App-ID": "936619743392459",
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
}


class AuthError(Exception):
    pass


def parse_url(url: str) -> Optional[str]:
    m = _URL_RE.search(url)
    return m.group(1) if m else None


def shortcode_to_pk(shortcode: str) -> int:
    n = 0
    for ch in shortcode[:11] if len(shortcode) > 28 else shortcode:
        n = n * 64 + _ALPHABET.index(ch)
    return n


def _cookies() -> Dict[str, str]:
    sid = os.environ.get("IG_SESSIONID")
    if not sid:
        raise AuthError("IG_SESSIONID is not set")
    c = {"sessionid": sid}
    if os.environ.get("IG_CSRFTOKEN"):
        c["csrftoken"] = os.environ["IG_CSRFTOKEN"]
    if os.environ.get("IG_DS_USER_ID"):
        c["ds_user_id"] = os.environ["IG_DS_USER_ID"]
    return c


def _get(url: str) -> requests.Response:
    r = requests.get(url, headers=HEADERS, cookies=_cookies(), timeout=20)
    if r.status_code in (401, 403) or "login_required" in r.text[:300]:
        raise AuthError(f"Instagram rejected the session (HTTP {r.status_code}) - refresh IG_SESSIONID")
    if r.status_code == 429:
        raise RuntimeError("Instagram rate limit (429)")
    r.raise_for_status()
    return r


def fetch_post(shortcode: str) -> Dict[str, Any]:
    data = _get(f"https://www.instagram.com/api/v1/media/{shortcode_to_pk(shortcode)}/info/").json()
    items = data.get("items") or []
    if not items:
        raise RuntimeError("post not found / not visible to this account")
    m = items[0]
    views = (
        m.get("play_count") or m.get("ig_play_count") or m.get("video_view_count")
        or (m.get("clips_metadata") or {}).get("play_count")
    )
    caption = (m.get("caption") or {}).get("text") or ""
    return {
        "likes": m.get("like_count"),
        "comments": m.get("comment_count"),
        "views": views,
        "shares": m.get("reshare_count") or m.get("share_count"),
        "author": (m.get("user") or {}).get("username"),
        "title": caption[:80] or None,
    }


def fetch_profile(handle: str) -> Dict[str, Any]:
    data = _get(
        f"https://www.instagram.com/api/v1/users/web_profile_info/?username={handle}"
    ).json()
    u = data["data"]["user"]
    return {
        "followers": u["edge_followed_by"]["count"],
        "following": u["edge_follow"]["count"],
        "posts_count": u["edge_owner_to_timeline_media"]["count"],
    }
