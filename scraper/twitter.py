"""X / Twitter via the Apify actor kaitoeasyapi/twitter-x-data-tweet-scraper-pay-per-result-cheapest.

NOTE: on Apify's FREE plan this actor (like every X actor tested) returns only demo "mock_tweet" items.
It works once the Apify account is on a paid plan. Field names: likeCount, replyCount, retweetCount, viewCount, author{}.
"""
import re
from typing import Any, Dict, List, Optional

from apify_api import ApifyError, run_actor

ACTOR = "kaitoeasyapi/twitter-x-data-tweet-scraper-pay-per-result-cheapest"
_URL_RE = re.compile(r"(?:twitter|x)\.com/(\w+)/status(?:es)?/(\d+)")
FREE_PLAN_MSG = "X needs a paid Apify plan (the free plan only returns demo tweets)"


def parse_url(url: str) -> Optional[tuple]:
    m = _URL_RE.search(url)
    return (m.group(1), m.group(2)) if m else None


def _count(v: Any) -> Optional[int]:
    return int(v) if isinstance(v, (int, float)) and v >= 0 else None


def _real(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if any(it.get("type") == "mock_tweet" for it in items):
        raise ApifyError(FREE_PLAN_MSG)
    return [it for it in items if not it.get("noResults")]


def map_post(item: Dict[str, Any]) -> Dict[str, Any]:
    author = item.get("author") or {}
    return {
        "likes": _count(item.get("likeCount")),
        "comments": _count(item.get("replyCount")),
        "views": _count(item.get("viewCount")),
        "shares": _count(item.get("retweetCount")),
        "author": author.get("userName") if isinstance(author, dict) else None,
        "title": ((item.get("text") or item.get("fullText") or "").replace("\n", " ")[:80]) or None,
        "thumbnail": _thumb(item),
    }


def _thumb(item: Dict[str, Any]) -> Optional[str]:
    """First attached photo/video still, else the author's profile picture."""
    for key in ("extendedEntities", "entities"):
        media = (item.get(key) or {}).get("media") or []
        if media and isinstance(media[0], dict) and media[0].get("media_url_https"):
            return media[0]["media_url_https"]
    author = item.get("author") or {}
    return author.get("profilePicture") if isinstance(author, dict) else None


def fetch_posts(ids: List[str]) -> Dict[str, Any]:
    items = _real(run_actor(ACTOR, {"tweetIDs": ids, "maxItems": len(ids)}))
    out: Dict[str, Any] = {}
    for it in items:
        tid = str(it.get("id") or "")
        if tid in ids and tid not in out:
            out[tid] = map_post(it)
    for i in ids:
        out.setdefault(i, RuntimeError("post unavailable (deleted, suspended or protected)"))
    return out


def fetch_profiles(handles: List[str]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for h in handles:  # the account's newest tweet carries its author's follower numbers
        items = _real(run_actor(ACTOR, {"searchTerms": [f"from:{h.lstrip('@')}"], "maxItems": 1, "queryType": "Latest"}))
        a = next((i.get("author") for i in items if isinstance(i.get("author"), dict)), None)
        out[h] = ({"followers": _count(a.get("followers")), "following": _count(a.get("following")),
                   "posts_count": _count(a.get("statusesCount"))} if a else RuntimeError("account not found, protected or has no tweets"))
    return out


def _created(s: Any) -> Optional[str]:
    """X dates look like 'Wed Oct 10 20:19:24 +0000 2018'; return ISO."""
    from datetime import datetime
    if not s:
        return None
    for fmt in ("%a %b %d %H:%M:%S %z %Y",):
        try:
            return datetime.strptime(str(s), fmt).isoformat()
        except ValueError:
            pass
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00")).isoformat()
    except ValueError:
        return None


def fetch_recent(handles: List[str], n: int = 5) -> Dict[str, Any]:
    """Newest own posts (no replies or reposts) of each account."""
    out: Dict[str, Any] = {}
    for h in handles:
        name = h.lstrip("@")
        items = _real(run_actor(ACTOR, {"searchTerms": [f"from:{name} -filter:replies -filter:nativeretweets"], "maxItems": n, "queryType": "Latest"}))
        posts = []
        for it in items:
            tid, ts = str(it.get("id") or ""), _created(it.get("createdAt"))
            if tid.isdigit() and ts:
                posts.append({"external_id": tid, "url": f"https://x.com/{name}/status/{tid}", "published_at": ts,
                              "title": ((it.get("text") or "").replace("\n", " ")[:80]) or None, "thumbnail": _thumb(it)})
        out[h] = posts
    return out
