"""YouTube metrics.

* With env YT_API_KEY (free, YouTube Data API v3, 10k units/day; each lookup costs 1 unit)
  -> views, likes, comments, subscribers via the official API.
* Without a key -> falls back to parsing the public watch/channel page (views + likes only,
  no comment count; subscriber count is rounded by YouTube, e.g. "66.2K").
"""
import json
import os
import re
from typing import Any, Dict, Optional

import requests

_ID_RE = re.compile(r"(?:youtube\.com/(?:watch\?(?:.*&)?v=|shorts/|live/|embed/)|youtu\.be/)([A-Za-z0-9_-]{11})")
UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
    "Cookie": "CONSENT=YES+1; SOCS=CAI",
}
API = "https://www.googleapis.com/youtube/v3"


def parse_url(url: str) -> Optional[str]:
    m = _ID_RE.search(url)
    return m.group(1) if m else None


def _key() -> Optional[str]:
    return os.environ.get("YT_API_KEY") or None


def _num(v: Any) -> Optional[int]:
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _short_count(text: str) -> Optional[int]:
    m = re.match(r"([\d.,]+)\s*([KMB]?)", text.strip(), re.I)
    if not m:
        return None
    mult = {"": 1, "K": 1e3, "M": 1e6, "B": 1e9}[m.group(2).upper()]
    return int(float(m.group(1).replace(",", "")) * mult)


def _api(path: str, **params: Any) -> Dict[str, Any]:
    r = requests.get(f"{API}/{path}", params={**params, "key": _key()}, timeout=20)
    if r.status_code in (400, 403):
        msg = (r.json().get("error") or {}).get("message", r.text[:120])
        raise RuntimeError(f"YouTube API error: {msg}")
    r.raise_for_status()
    return r.json()


def fetch_post(video_id: str) -> Dict[str, Any]:
    if _key():
        items = _api("videos", part="snippet,statistics", id=video_id).get("items") or []
        if not items:
            raise RuntimeError("video not found (private or deleted)")
        s, sn = items[0].get("statistics", {}), items[0].get("snippet", {})
        return {
            "likes": _num(s.get("likeCount")),
            "comments": _num(s.get("commentCount")),
            "views": _num(s.get("viewCount")),
            "shares": None,
            "author": sn.get("channelTitle"),
            "title": (sn.get("title") or "")[:80] or None,
        }

    r = requests.get("https://www.youtube.com/watch", params={"v": video_id}, headers=UA, timeout=25)
    if r.status_code == 429:
        raise RuntimeError("YouTube rate limit (429) - set YT_API_KEY to avoid this")
    r.raise_for_status()
    t = r.text
    vd = re.search(r'"videoDetails":\{"videoId":"%s".*?"viewCount":"(\d+)"' % re.escape(video_id), t, re.S)
    if not vd:
        raise RuntimeError("video unavailable (private, deleted or consent page)")
    likes = re.search(r'"likeCount":"(\d+)"', t)
    title = re.search(r'"videoDetails":\{"videoId":"[^"]+","title":"((?:[^"\\]|\\.)*)"', t)
    author = re.search(r'"author":"((?:[^"\\]|\\.)*)"', t)
    dec = lambda g: json.loads(f'"{g.group(1)}"') if g else None  # noqa: E731
    return {
        "likes": _num(likes.group(1)) if likes else None,
        "comments": None,
        "views": int(vd.group(1)),
        "shares": None,
        "author": dec(author),
        "title": (dec(title) or "")[:80] or None,
    }


def fetch_profile(handle: str) -> Dict[str, Any]:
    handle = handle.lstrip("@")
    if _key():
        items = _api("channels", part="statistics", forHandle="@" + handle).get("items") or []
        if not items:
            raise RuntimeError("channel not found")
        s = items[0]["statistics"]
        return {"followers": _num(s.get("subscriberCount")), "following": None, "posts_count": _num(s.get("videoCount"))}

    r = requests.get(f"https://www.youtube.com/@{handle}", headers=UA, timeout=25)
    if r.status_code == 404:
        raise RuntimeError("channel not found")
    r.raise_for_status()
    m = re.search(r'([\d.,]+[KMB]?) subscribers', r.text)
    if not m:
        raise RuntimeError("subscriber count not found (hidden or page changed)")
    return {"followers": _short_count(m.group(1)), "following": None, "posts_count": None}
