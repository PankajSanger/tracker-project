"""YouTube metrics via Selenium (headless Chrome) + Beautiful Soup.

* post: views (itemprop meta), likes (page data), comments (comments header after scrolling), title, channel
* channel: subscriber count from the channel page
"""
import json
import re
import time
from typing import Any, Dict, Optional

from bs4 import BeautifulSoup
from selenium.webdriver.common.by import By

import browser

_ID_RE = re.compile(r"(?:youtube\.com/(?:watch\?(?:.*&)?v=|shorts/|live/|embed/)|youtu\.be/)([A-Za-z0-9_-]{11})")


def parse_url(url: str) -> Optional[str]:
    m = _ID_RE.search(url)
    return m.group(1) if m else None


def _num(text: Optional[str]) -> Optional[int]:
    """'1,234' -> 1234, '66.2K' -> 66200, '1.2M' -> 1200000."""
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


def _handle_consent(driver) -> None:
    """EU-style cookie wall: click 'Reject all' / 'Accept all' if it is showing."""
    try:
        if "consent." not in driver.current_url and not driver.find_elements(By.CSS_SELECTOR, "ytd-consent-bump-v2-lightbox, tp-yt-paper-dialog form[action*='consent']"):
            return
        for label in ("Reject all", "Accept all", "I agree"):
            btns = driver.find_elements(By.XPATH, f"//button[.//span[contains(text(), '{label}')]] | //button[contains(@aria-label, '{label}')]")
            if btns:
                btns[0].click()
                time.sleep(1.5)
                return
    except Exception:  # noqa: BLE001
        pass


def _scripts_text(soup: BeautifulSoup) -> str:
    return "\n".join(s.string or "" for s in soup.find_all("script") if s.string and ("ytInitial" in s.string or "likeCount" in s.string))


def _player_response(soup: BeautifulSoup) -> Optional[dict]:
    """The page embeds `var ytInitialPlayerResponse = {...};` in a <script>; parse that JSON."""
    for s in soup.find_all("script"):
        t = s.string or ""
        i = t.find("ytInitialPlayerResponse")
        if i < 0:
            continue
        j = t.find("{", i)
        if j < 0:
            continue
        try:
            obj, _ = json.JSONDecoder().raw_decode(t[j:])
            if isinstance(obj, dict) and ("videoDetails" in obj or "playabilityStatus" in obj):
                return obj
        except ValueError:
            continue
    return None


def _ready(soup: BeautifulSoup) -> bool:
    head = soup.get_text(" ", strip=True)[:4000].lower()
    return _player_response(soup) is not None or "not a bot" in head or "video unavailable" in head


def fetch_post(video_id: str, post: Optional[dict] = None) -> Dict[str, Any]:
    driver = browser.get_driver()
    driver.get(f"https://www.youtube.com/watch?v={video_id}")
    _handle_consent(driver)
    soup = browser.wait_for(driver, _ready, timeout=18)

    text_head = soup.get_text(" ", strip=True)[:6000]
    if "not a bot" in text_head.lower() or "unusual traffic" in text_head.lower():
        raise RuntimeError("YouTube asked to verify the visitor is not a bot (this machine's IP is being challenged)")

    pr = _player_response(soup) or {}
    details = pr.get("videoDetails") or {}
    if details.get("videoId") != video_id or "viewCount" not in details:
        status = (pr.get("playabilityStatus") or {}).get("reason") or "private, deleted, age-restricted or blocked page"
        raise RuntimeError(f"video unavailable ({status})")
    views = _num(details.get("viewCount"))
    title = details.get("title")
    author = details.get("author")

    # likes: the like button's accessibility text / data blob
    blob = _scripts_text(soup)
    likes = None
    m = re.search(r'"likeCount"\s*:\s*"?(\d+)"?', blob)
    if m:
        likes = int(m.group(1))
    else:
        m = re.search(r"like this video along with ([\d,]+) other people", blob)
        if m:
            likes = _num(m.group(1))
    if likes is None:
        btn = soup.select_one("like-button-view-model button, #segmented-like-button button")
        if btn and btn.get("aria-label"):
            likes = _num(btn["aria-label"])

    # comments: the section only renders after scrolling down in steps
    comments = None
    cre = re.compile(r"([\d][\d.,]*\s*[KMB]?)\s+Comments", re.I)
    def _header_count(soup: BeautifulSoup) -> Optional[str]:
        hdr = soup.find("ytd-comments-header-renderer")
        m = cre.search(hdr.get_text(" ", strip=True)) if hdr else None
        return m.group(1) if m else None

    try:
        time.sleep(2.5)  # let the player and page settle; comments only start loading afterwards
        for attempt in range(3):
            driver.execute_script(
                "var c = document.querySelector('ytd-comments'); "
                "if (c) { c.scrollIntoView({block: 'start'}); } else { window.scrollBy(0, 900); }"
            )
            soup3 = browser.wait_for(driver, lambda sp: _header_count(sp) is not None, timeout=7, poll=0.8)
            found = _header_count(soup3)
            if found:
                comments = _num(found)
                break
            driver.execute_script("window.scrollBy(0, -300); window.scrollBy(0, 500);")  # nudge to trigger the lazy loader
    except Exception:  # noqa: BLE001
        pass

    return {
        "likes": likes,
        "comments": comments,
        "views": views,
        "shares": None,
        "author": author,
        "title": (title or "")[:80] or None,
    }


def fetch_profile(handle: str) -> Dict[str, Any]:
    driver = browser.get_driver()
    driver.get(f"https://www.youtube.com/@{handle.lstrip('@')}")
    _handle_consent(driver)
    soup = browser.wait_for(driver, lambda s: bool(re.search(r"[\d.,]+\s*[KMB]?\s+subscribers", s.get_text(" "))), timeout=15)
    text = soup.get_text(" ", strip=True)
    if "This page isn't available" in text or "404" in (soup.title.string if soup.title and soup.title.string else ""):
        raise RuntimeError("channel not found")
    m = re.search(r"([\d.,]+\s*[KMB]?)\s+subscribers", text)
    if not m:
        raise RuntimeError("subscriber count not found (hidden or page changed)")
    videos = re.search(r"([\d.,]+\s*[KMB]?)\s+videos", text)
    return {"followers": _num(m.group(1)), "following": None, "posts_count": _num(videos.group(1)) if videos else None}
