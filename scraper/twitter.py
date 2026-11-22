"""Twitter/X scraping via the public syndication endpoints used by embedded tweets.

Free and needs no login. Exposes likes + replies. Retweets/views are generally
not available from this endpoint (stored as null unless present).
"""
import json
import math
import re
from typing import Any, Dict, Optional

import requests

_URL_RE = re.compile(r"(?:twitter|x)\.com/(\w+)/status(?:es)?/(\d+)")
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"}


def parse_url(url: str) -> Optional[tuple]:
    m = _URL_RE.search(url)
    return (m.group(1), m.group(2)) if m else None


def _b36(x: float) -> str:
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    ip, fp = int(x), x - int(x)
    s = ""
    while ip:
        s = digits[ip % 36] + s
        ip //= 36
    s = (s or "0") + "."
    for _ in range(11):
        fp *= 36
        d = int(fp)
        s += digits[d]
        fp -= d
    return s


def _token(tweet_id: str) -> str:
    return re.sub(r"(0+|\.)", "", _b36((int(tweet_id) / 1e15) * math.pi))


def _fx(path: str) -> Optional[Dict[str, Any]]:
    """FixTweet public API (free, no key): adds retweets/views and works for profiles."""
    try:
        r = requests.get(f"https://api.fxtwitter.com/{path}", headers={"User-Agent": "social-tracker/1.0"}, timeout=20)
        return r.json() if r.ok else None
    except (requests.RequestException, ValueError):
        return None


def fetch_post(tweet_id: str) -> Dict[str, Any]:
    out = _fetch_post_syndication(tweet_id)
    fx = _fx(f"i/status/{tweet_id}")
    t = (fx or {}).get("tweet") or {}
    if t:
        out["shares"] = out["shares"] if out["shares"] is not None else t.get("retweets")
        out["views"] = out["views"] or t.get("views")
        for k in ("likes", "comments"):
            if out[k] is None:
                out[k] = t.get("likes" if k == "likes" else "replies")
    return out


def _fetch_post_syndication(tweet_id: str) -> Dict[str, Any]:
    r = requests.get(
        "https://cdn.syndication.twimg.com/tweet-result",
        params={"id": tweet_id, "lang": "en", "token": _token(tweet_id)},
        headers=UA, timeout=20,
    )
    if r.status_code == 404:
        raise RuntimeError("tweet not found (deleted or protected)")
    if r.status_code == 429:
        raise RuntimeError("Twitter rate limit (429)")
    r.raise_for_status()
    d = r.json()
    if not d or "favorite_count" not in d:
        raise RuntimeError("tweet unavailable")
    views = (d.get("views") or {}).get("count")
    return {
        "likes": d.get("favorite_count"),
        "comments": d.get("conversation_count"),
        "views": int(views) if views else None,
        "shares": d.get("retweet_count"),
        "author": (d.get("user") or {}).get("screen_name"),
        "title": (d.get("text") or "")[:80] or None,
    }


def fetch_profile(handle: str) -> Dict[str, Any]:
    u = ((_fx(handle) or {}).get("user")) or {}
    if u.get("followers") is not None:
        return {"followers": u["followers"], "following": u.get("following"), "posts_count": u.get("tweets")}
    return _fetch_profile_syndication(handle)


def _fetch_profile_syndication(handle: str) -> Dict[str, Any]:
    r = requests.get(
        f"https://syndication.twitter.com/srv/timeline-profile/screen-name/{handle}",
        headers=UA, timeout=20,
    )
    r.raise_for_status()
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', r.text, re.S)
    if not m:
        raise RuntimeError("profile page unavailable (rate-limited?)")
    entries = json.loads(m.group(1))["props"]["pageProps"]["timeline"]["entries"]
    for e in entries:
        user = ((e.get("content") or {}).get("tweet") or {}).get("user")
        if user and user.get("screen_name", "").lower() == handle.lower():
            return {
                "followers": user.get("followers_count"),
                "following": user.get("friends_count"),
                "posts_count": user.get("statuses_count"),
            }
    raise RuntimeError("could not find profile data")
