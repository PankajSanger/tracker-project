"""YouTube via the Apify actor streamers/youtube-scraper (no browser).

posts:    viewCount, likes, commentsCount, channelName, title
channels: numberOfSubscribers (read from the channel's newest video)
"""
import re
from typing import Any, Dict, List, Optional

from apify_api import run_actor

ACTOR = "streamers/youtube-scraper"
_ID_RE = re.compile(r"(?:youtube\.com/(?:watch\?(?:.*&)?v=|shorts/|live/|embed/)|youtu\.be/)([A-Za-z0-9_-]{11})")


def parse_url(url: str) -> Optional[str]:
    m = _ID_RE.search(url)
    return m.group(1) if m else None


def _count(v: Any) -> Optional[int]:
    return int(v) if isinstance(v, (int, float)) and v >= 0 else None


def map_post(item: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "likes": _count(item.get("likes")),
        "comments": _count(item.get("commentsCount")),
        "views": _count(item.get("viewCount")),
        "shares": None,
        "author": item.get("channelName"),
        "title": (item.get("title") or "")[:80] or None,
        "thumbnail": item.get("thumbnailUrl") or None,
    }


def fetch_posts(ids: List[str]) -> Dict[str, Any]:
    items = run_actor(ACTOR, {
        "startUrls": [{"url": f"https://www.youtube.com/watch?v={i}"} for i in ids],
        "maxResults": 1, "maxResultsShorts": 0, "maxResultStreams": 0,
    })
    out: Dict[str, Any] = {}
    for it in items:
        vid = it.get("id") or parse_url(it.get("url") or "")
        if vid in ids and vid not in out and it.get("viewCount") is not None:
            out[vid] = map_post(it)
    for i in ids:
        out.setdefault(i, RuntimeError("video unavailable (Apify returned nothing - deleted or private?)"))
    return out


def fetch_profiles(handles: List[str]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for h in handles:  # one small run per channel: results do not say reliably which input they came from
        items = run_actor(ACTOR, {"startUrls": [{"url": f"https://www.youtube.com/@{h.lstrip('@')}/videos"}],
                                  "maxResults": 1, "maxResultsShorts": 0, "maxResultStreams": 0})
        it = next((i for i in items if i.get("numberOfSubscribers") is not None), None)
        out[h] = ({"followers": _count(it["numberOfSubscribers"]), "following": None,
                   "posts_count": _count(it.get("channelTotalVideos"))} if it else RuntimeError("channel not found"))
    return out
