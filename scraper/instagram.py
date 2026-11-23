"""Instagram metrics via Selenium (headless Chrome) + Beautiful Soup. No login, no API, no account at risk.

A logged-out visitor can load any public post or profile page, and the page's own data contains:
  post:     exact likes and comments (from the embedded JSON), creator, caption   (cross-checked with the
            public `og:description` summary, e.g. "79K likes, 355 comments - user on August 1, 2026: ...")
  profile:  exact followers (embedded JSON), following and posts (`og:description`)
Instagram only gives view counts and shares to logged-in sessions, so those stay empty (shown as "-").
"""
import re
import time
from typing import Any, Dict, Optional

from bs4 import BeautifulSoup

import browser

_URL_RE = re.compile(r"instagram\.com/(?:[\w.]+/)?(?:p|reel|tv|reels)/([A-Za-z0-9_\-]+)")


class AuthError(Exception):
    """Kept for compatibility with scrape.py; Instagram scraping needs no login so this is not raised."""


class RateLimited(Exception):
    """Instagram sent the browser to its login page (this IP is being throttled). Stop for this run."""


def parse_url(url: str) -> Optional[str]:
    m = _URL_RE.search(url)
    return m.group(1) if m else None


# ----------------------------------------------------------------- parsing helpers (pure functions)
def _abbr(text: Optional[str]) -> Optional[int]:
    """'1,931' -> 1931, '79K' -> 79000, '2M' -> 2000000."""
    v = _abbr_tol(text)
    return v[0] if v else None


def _abbr_tol(text: Optional[str]):
    """Like _abbr but also returns how coarse the rounding is: '2M' -> (2000000, 500000), '79K' -> (79000, 500), '1,931' -> (1931, 0)."""
    if not text:
        return None
    m = re.search(r"([\d][\d.,]*)\s*([KMB]?)", text.strip(), re.I)
    if not m:
        return None
    suffix = m.group(2).upper()
    mult = {"": 1, "K": 1e3, "M": 1e6, "B": 1e9}[suffix]
    num = m.group(1).replace(",", "") if not suffix else m.group(1).replace(",", "")
    try:
        value = int(round(float(num) * mult))
    except ValueError:
        return None
    if not suffix:
        return value, 0
    decimals = len(num.split(".")[1]) if "." in num else 0
    return value, int(mult * (10 ** -decimals) / 2) + 1


def _pick_exact(approx, candidates: list) -> Optional[int]:
    """The page summary is rounded ("79K", "2M"); choose the exact number from the embedded JSON that agrees with it."""
    value, tol = approx if approx else (None, 0)
    if not candidates:
        return value
    if value is None:
        return candidates[0]
    for c in candidates:
        if abs(c - value) <= tol + value * 0.005:
            return c
    return value


def _og(soup: BeautifulSoup, prop: str = "og:description") -> Optional[str]:
    tag = soup.find("meta", property=prop)
    return tag.get("content") if tag and tag.get("content") else None


def _script_numbers(soup: BeautifulSoup, key: str) -> list:
    text = "\n".join(s.string for s in soup.find_all("script") if s.string and key in s.string)
    return [int(x) for x in re.findall(rf'"{key}"\s*:\s*(\d+)', text)]


def parse_post(soup: BeautifulSoup) -> Optional[Dict[str, Any]]:
    """Return the post's numbers, or None when the page holds no post data (deleted / private / blocked)."""
    og = _og(soup)
    if not og and not _script_numbers(soup, "like_count"):
        return None
    likes_t = re.search(r"([\d][\d.,]*\s*[KMB]?)\s+likes?\b", og or "", re.I)
    comm_t = re.search(r"([\d][\d.,]*\s*[KMB]?)\s+comments?\b", og or "", re.I)
    author = re.search(r"-\s+(\S+)\s+on\s", og or "")
    caption = re.search(r'on [^:]+:\s*["“](.*)["”]\.?\s*$', og or "", re.S)

    hidden = bool(re.search(r'"like_and_view_counts_disabled"\s*:\s*true', "\n".join(s.string or "" for s in soup.find_all("script") if s.string and "like_and_view" in s.string)))
    likes = None if hidden else _pick_exact(_abbr_tol(likes_t.group(1)) if likes_t else None, _script_numbers(soup, "like_count"))
    comments = _pick_exact(_abbr_tol(comm_t.group(1)) if comm_t else None, _script_numbers(soup, "comment_count"))
    return {
        "likes": likes,
        "comments": comments,
        "views": None,   # logged-out pages do not expose view counts
        "shares": None,
        "author": author.group(1) if author else None,
        "title": (caption.group(1).strip().replace("\n", " ")[:80] if caption else None) or None,
    }


def parse_profile(soup: BeautifulSoup) -> Optional[Dict[str, Any]]:
    og = _og(soup)
    if not og:
        return None
    fol = re.search(r"([\d][\d.,]*\s*[KMB]?)\s+Followers", og, re.I)
    fng = re.search(r"([\d][\d.,]*\s*[KMB]?)\s+Following", og, re.I)
    pst = re.search(r"([\d][\d.,]*\s*[KMB]?)\s+Posts", og, re.I)
    if not fol:
        return None
    return {
        "followers": _pick_exact(_abbr_tol(fol.group(1)), _script_numbers(soup, "follower_count")),
        "following": _abbr(fng.group(1)) if fng else None,
        "posts_count": _abbr(pst.group(1)) if pst else None,
    }


# ------------------------------------------------------------------------------- browser part
def _load(url: str, ready) -> BeautifulSoup:
    driver = browser.get_driver()
    driver.get(url)
    if "/accounts/login" in driver.current_url:
        raise RateLimited("Instagram redirected to its login page (this IP is being throttled) - will retry next run")
    soup = browser.wait_for(driver, ready, timeout=14, poll=0.8)
    if "/accounts/login" in driver.current_url:
        raise RateLimited("Instagram redirected to its login page (this IP is being throttled) - will retry next run")
    return soup


def fetch_post(shortcode: str, post: Optional[dict] = None) -> Dict[str, Any]:
    def ready(s: BeautifulSoup) -> bool:
        return bool(_script_numbers(s, "like_count")) or "isn't available" in s.get_text(" ")[:2500] or "isn’t available" in s.get_text(" ")[:2500]

    soup = _load(f"https://www.instagram.com/p/{shortcode}/", ready)
    data = parse_post(soup)
    if data is None or (data["likes"] is None and data["comments"] is None and not _og(soup)):
        raise RuntimeError("post unavailable (deleted, private, or Instagram showed a block page)")
    time.sleep(0.5)
    return data


def fetch_profile(handle: str) -> Dict[str, Any]:
    handle = handle.lstrip("@")
    soup = _load(f"https://www.instagram.com/{handle}/", lambda s: bool(_og(s)) or "isn't available" in s.get_text(" ")[:2500] or "isn’t available" in s.get_text(" ")[:2500])
    data = parse_profile(soup)
    if data is None:
        raise RuntimeError("profile unavailable (not found, private or blocked page)")
    return data
