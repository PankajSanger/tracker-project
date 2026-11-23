"""X (Twitter) metrics via Selenium (headless Chrome) + Beautiful Soup. No login needed.

* post: exact replies / reposts / likes / bookmarks / views are in the tweet's accessibility label
  (e.g. "19261 replies, 134381 reposts, 327055 likes, 25505 bookmarks")
* profile: followers / following / posts from the profile header (X abbreviates large numbers, e.g. "92.1M")
"""
import re
from typing import Any, Dict, Optional

from bs4 import BeautifulSoup

import browser

_URL_RE = re.compile(r"(?:twitter|x)\.com/(\w+)/status(?:es)?/(\d+)")
_GROUP_RE = re.compile(r"\d[\d,]* (?:replies|reply),.*\d[\d,]* likes?", re.I)


def parse_url(url: str) -> Optional[tuple]:
    m = _URL_RE.search(url)
    return (m.group(1), m.group(2)) if m else None


def _num(text: Optional[str]) -> Optional[int]:
    if not text:
        return None
    m = re.search(r"([\d][\d.,]*)\s*([KMB]?)", text.strip(), re.I)
    if not m:
        return None
    mult = {"": 1, "K": 1e3, "M": 1e6, "B": 1e9}[m.group(2).upper()]
    try:
        return int(round(float(m.group(1).replace(",", "")) * mult))
    except ValueError:
        return None


def _metric(label: str, word: str) -> Optional[int]:
    m = re.search(rf"([\d,]+)\s+{word}", label, re.I)
    return int(m.group(1).replace(",", "")) if m else None


def _focal_group(soup: BeautifulSoup):
    """The first engagement group on the page belongs to the tweet being viewed (replies follow it)."""
    for el in soup.find_all(attrs={"aria-label": _GROUP_RE}):
        return el
    return None


def fetch_post(tweet_id: str, post: Optional[dict] = None) -> Dict[str, Any]:
    driver = browser.get_driver()
    url = (post or {}).get("url") or ""
    handle = (parse_url(url) or (None, None))[0]
    driver.get(f"https://x.com/{handle or 'i'}/status/{tweet_id}")
    soup = browser.wait_for(
        driver,
        lambda s: _focal_group(s) is not None or any(k in s.get_text(" ")[:3000] for k in ("doesn’t exist", "doesn't exist", "Something went wrong", "suspended")),
        timeout=18,
    )
    group = _focal_group(soup)
    if group is None:
        head = soup.get_text(" ", strip=True)[:3000]
        if "exist" in head or "suspended" in head or "deleted" in head:
            raise RuntimeError("post unavailable (deleted, suspended or protected)")
        if "Log in" in head and "Sign up" in head:
            raise RuntimeError("X is asking for a login for this post (try again later)")
        raise RuntimeError("could not read the engagement numbers (page layout changed or rate limited)")

    label = group.get("aria-label", "")
    title = soup.title.string if soup.title and soup.title.string else ""
    m = re.match(r'^(.*?) on X: ["“](.*)["”] / X$', title, re.S)
    text = m.group(2).strip().replace("\n", " ") if m else None
    author = handle
    if not author:
        canon = soup.find("link", rel="canonical")
        cm = _URL_RE.search(canon.get("href", "")) if canon else None
        author = cm.group(1) if cm else (m.group(1) if m else None)

    return {
        "likes": _metric(label, "likes?"),
        "comments": _metric(label, "repl(?:ies|y)"),
        "views": _metric(label, "views?"),
        "shares": _metric(label, "reposts?"),
        "author": author,
        "title": (text or "")[:80] or None,
    }


def fetch_profile(handle: str) -> Dict[str, Any]:
    handle = handle.lstrip("@")
    driver = browser.get_driver()
    driver.get(f"https://x.com/{handle}")
    soup = browser.wait_for(driver, lambda s: bool(s.find("a", href=re.compile(r"/verified_followers$"))) or "doesn’t exist" in s.get_text(" ")[:3000], timeout=15)
    link = soup.find("a", href=re.compile(r"/verified_followers$"))
    if not link:
        text = soup.get_text(" ", strip=True)[:3000]
        if "doesn’t exist" in text or "doesn't exist" in text or "suspended" in text:
            raise RuntimeError("account not found or suspended")
        raise RuntimeError("profile not readable (page layout changed or X is asking for a login)")
    following = soup.find("a", href=re.compile(r"/following$"))
    posts = re.search(r"([\d.,]+[KMB]?)\s+posts", soup.get_text(" ", strip=True), re.I)
    return {
        "followers": _num(link.get_text(" ", strip=True)),
        "following": _num(following.get_text(" ", strip=True)) if following else None,
        "posts_count": _num(posts.group(1)) if posts else None,
    }
