"""Instagram metrics via Selenium (headless Chrome) + Beautiful Soup. No login, no API, no account at risk.

A logged-out visitor can load any public post or profile page, and the page's own data contains:
  post:     exact likes and comments (from the embedded JSON), creator, caption   (cross-checked with the
            public `og:description` summary, e.g. "79K likes, 355 comments - user on August 1, 2026: ...")
  profile:  exact followers (embedded JSON), following and posts (`og:description`)
  views:    exact play counts of reels from the creator's reels grid (/{user}/reels/). Logged out, Instagram shows the
            newest ~12 reels there; with an optional logged-in browser profile (ig_login.py) the grid is scrolled further
            back and the exact counts are read from the page's own network responses.
Shares are never shown on the web, so they stay empty.
"""
import json
import os
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


# --------------------------------------------------------------------------- reels grid (views)
GRID_SCROLLS = int(os.getenv("IG_GRID_SCROLLS", "25"))
_grid: Dict[str, Dict[str, Any]] = {}


def _collect_media(obj: Any, out: Dict[str, Dict[str, Any]]) -> None:
    """Walk any JSON value and keep every media object that has a shortcode and counters."""
    if isinstance(obj, dict):
        code = obj.get("code") or obj.get("shortcode")
        if isinstance(code, str) and any(k in obj for k in ("play_count", "ig_play_count", "like_count", "video_view_count")):
            views = next((obj[k] for k in ("play_count", "ig_play_count", "video_play_count", "video_view_count") if isinstance(obj.get(k), int)), None)
            prev = out.get(code, {})
            out[code] = {
                "views": views if views is not None else prev.get("views"),
                "likes": obj.get("like_count") if isinstance(obj.get("like_count"), int) else prev.get("likes"),
                "comments": obj.get("comment_count") if isinstance(obj.get("comment_count"), int) else prev.get("comments"),
            }
        for v in obj.values():
            _collect_media(v, out)
    elif isinstance(obj, list):
        for v in obj:
            _collect_media(v, out)


def _media_from_text(text: str, out: Dict[str, Dict[str, Any]]) -> None:
    dec = json.JSONDecoder()
    try:
        _collect_media(json.loads(text), out)
        return
    except ValueError:
        pass
    for m in re.finditer(r'\{"require"|\{"data"', text):  # page <script> blobs
        try:
            obj, _ = dec.raw_decode(text[m.start():])
            _collect_media(obj, out)
        except ValueError:
            continue


def logged_in() -> bool:
    try:
        return any(c.get("name") == "sessionid" and c.get("value") for c in browser.get_driver().get_cookies())
    except Exception:  # noqa: BLE001
        return False


def grid_lookup(author: str, code: str) -> Optional[Dict[str, Any]]:
    """Exact views/likes/comments of one reel from its creator's reels grid (cached per creator for the run)."""
    author = author.lstrip("@").lower()
    entry = _grid.get(author)
    if entry is None or (code not in entry["items"] and not entry["exhausted"]):
        driver = browser.get_driver()
        browser.network_json_bodies(driver)  # drop older network log entries
        soup = _load(f"https://www.instagram.com/{author}/reels/", lambda s: bool(s.find("a", href=re.compile(r"/reel/"))) or "isn't available" in s.get_text(" ")[:2500] or "isn’t available" in s.get_text(" ")[:2500])
        items: Dict[str, Dict[str, Any]] = dict(entry["items"]) if entry else {}
        for sc in soup.find_all("script"):
            if sc.string and ("play_count" in sc.string or "like_count" in sc.string):
                _media_from_text(sc.string, items)
        exhausted = True
        if code not in items and logged_in():
            stale, last_tiles = 0, -1
            for _ in range(GRID_SCROLLS):
                driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
                time.sleep(2.2)
                for body in browser.network_json_bodies(driver):
                    _media_from_text(body, items)
                if code in items:
                    exhausted = False
                    break
                tiles = len(browser.soup_of(driver).find_all("a", href=re.compile(r"/reel/")))
                stale = stale + 1 if tiles == last_tiles else 0
                last_tiles = tiles
                if stale >= 3:  # reached the end of the grid
                    break
        entry = _grid[author] = {"items": items, "exhausted": exhausted}
    return entry["items"].get(code)


def fetch_post(shortcode: str, post: Optional[dict] = None) -> Dict[str, Any]:
    author = ((post or {}).get("author") or "").strip().lstrip("@")
    # "1" (PC): grid first. "0" or "late" (GitHub): post page only; with "late" scrape.py tries the grids after all posts.
    use_grid = os.getenv("IG_GRID", "1") not in ("0", "late")
    if author and use_grid:
        item = grid_lookup(author, shortcode)
        if item and item.get("views") is not None and item.get("likes") is not None:
            return {"likes": item["likes"], "comments": item["comments"], "views": item["views"], "shares": None, "author": author, "title": None}
    data = _fetch_post_page(shortcode)
    if not author and data.get("author") and use_grid:
        item = grid_lookup(data["author"], shortcode)
        if item and item.get("views") is not None:
            data["views"] = item["views"]
    elif author:
        item = (_grid.get(author.lower()) or {}).get("items", {}).get(shortcode)
        if item and item.get("views") is not None:
            data["views"] = item["views"]
    return data


def _fetch_post_page(shortcode: str) -> Dict[str, Any]:
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
