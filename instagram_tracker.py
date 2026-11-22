"""
instagram_tracker.py
====================
Production-ready Instagram Post / Reel engagement tracker.

Flow
----
1.  Read active post URLs from the "input" tab of a Google Sheet.
2.  Log into Instagram once (manual); session is persisted via Chrome
    user-data-dir so subsequent runs are fully automatic.
3.  For each URL, try multiple extraction strategies in order:
        a) Private GraphQL endpoint  /?__a=1&__d=dis
        b) JSON-LD <script> tags embedded in the page
        c) DOM / aria-label scraping via Selenium
4.  Append timestamped rows to the "tracking_data" tab (never overwrites).
5.  Sleep, then repeat every TRACKING_INTERVAL_MINUTES.

Run:
    python instagram_tracker.py

Press Ctrl+C to stop the scheduler gracefully.
"""

from __future__ import annotations

import json
import logging
import os
import random
import re
import sys
import time
import traceback
import unicodedata
from datetime import datetime
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any, Dict, List, Optional

import pandas as pd
import pygsheets
import schedule
import undetected_chromedriver as uc
from bs4 import BeautifulSoup
from selenium import webdriver
from selenium.common.exceptions import (
    NoSuchElementException,
    SessionNotCreatedException,
    TimeoutException,
    WebDriverException,
)
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

import config

# ─────────────────────────────────────────────────────────────────────────────
#  Logging
# ─────────────────────────────────────────────────────────────────────────────

def setup_logging() -> logging.Logger:
    Path(config.LOG_DIR).mkdir(parents=True, exist_ok=True)

    fmt     = "%(asctime)s | %(levelname)-8s | %(funcName)-32s | %(message)s"
    datefmt = "%Y-%m-%d %H:%M:%S"
    level   = getattr(logging, config.LOG_LEVEL.upper(), logging.INFO)

    logger = logging.getLogger("ig_tracker")
    logger.setLevel(level)

    if not logger.handlers:
        # Console
        ch = logging.StreamHandler(sys.stdout)
        ch.setFormatter(logging.Formatter(fmt, datefmt))
        ch.setLevel(level)
        logger.addHandler(ch)

        # Rotating file — 5 MB × 5 backups
        fh = RotatingFileHandler(
            config.LOG_FILE,
            maxBytes=5 * 1024 * 1024,
            backupCount=5,
            encoding="utf-8",
        )
        fh.setFormatter(logging.Formatter(fmt, datefmt))
        fh.setLevel(level)
        logger.addHandler(fh)

    return logger


log = setup_logging()


# ─────────────────────────────────────────────────────────────────────────────
#  Chrome / Selenium helpers
# ─────────────────────────────────────────────────────────────────────────────

def get_chrome_options() -> uc.ChromeOptions:
    """
    Minimal Chrome options that pass Instagram's bot detection.

    IMPORTANT — flags to NEVER add on Windows for Instagram:
      --no-sandbox            → Linux/Docker flag; huge bot signal
      --disable-gpu           → bot signal
      --disable-dev-shm-usage → Linux-only flag; bot signal
      --user-data-dir         → conflicts with uc patching on Windows,
                                causes login-page refresh loop
      --disable-blink-features / excludeSwitches → uc handles internally

    pageLoadStrategy=eager   → returns as soon as DOM is ready; does NOT
                               wait for images/videos/ads to finish loading.
                               Prevents page-load timeouts on heavy Reels pages.

    Session is persisted via instagram_cookies.json instead of user-data-dir.
    """
    opts = uc.ChromeOptions()

    # Eager strategy: driver.get() returns when DOM is interactive,
    # not after every image/video/script finishes — critical for Reels.
    opts.page_load_strategy = "eager"

    opts.add_argument("--start-maximized")
    opts.add_argument("--lang=en-US")
    opts.add_argument("--disable-notifications")

    return opts


def get_chrome_major_version() -> Optional[int]:
    """
    Detect the major version of the installed Google Chrome on Windows.
    Tries the registry first, then falls back to known exe paths.
    Returns None if detection fails.
    """
    import subprocess

    # 1. Windows registry (most reliable)
    try:
        import winreg
        for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
            for sub in (
                r"Software\Google\Chrome\BLBeacon",
                r"Software\Wow6432Node\Google\Chrome\BLBeacon",
            ):
                try:
                    key = winreg.OpenKey(hive, sub)
                    ver, _ = winreg.QueryValueEx(key, "version")
                    winreg.CloseKey(key)
                    major = int(str(ver).split(".")[0])
                    log.info("Chrome version from registry: %s (major=%d)", ver, major)
                    return major
                except OSError:
                    continue
    except Exception:
        pass

    # 2. Chrome executable --version flag
    candidates = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
    ]
    for exe in candidates:
        if os.path.isfile(exe):
            try:
                result = subprocess.run(
                    [exe, "--version"],
                    capture_output=True, text=True, timeout=5,
                )
                m = re.search(r"(\d+)\.", result.stdout)
                if m:
                    major = int(m.group(1))
                    log.info("Chrome version from exe: %s (major=%d)", result.stdout.strip(), major)
                    return major
            except Exception:
                pass

    log.warning("Could not detect Chrome version — uc will use latest ChromeDriver.")
    return None


def create_driver() -> uc.Chrome:
    """
    Instantiate an undetected Chrome instance with the exact matching
    ChromeDriver version (read from Windows registry).

    - No use_subprocess on Windows (causes patching to fail silently)
    - Minimal options only — every extra flag is a bot signal
    - Session persistence done via cookies, not --user-data-dir
    """
    opts    = get_chrome_options()
    version = get_chrome_major_version()

    log.info(
        "Launching undetected Chrome (version_main=%s) …",
        version if version else "auto",
    )

    kwargs: Dict[str, Any] = {"options": opts}
    if version:
        kwargs["version_main"] = version
    if config.CHROMEDRIVER_PATH:
        kwargs["driver_executable_path"] = config.CHROMEDRIVER_PATH

    driver = uc.Chrome(**kwargs)
    driver.set_page_load_timeout(config.PAGE_LOAD_TIMEOUT)
    log.info("Undetected ChromeDriver ready.")
    return driver


# ─────────────────────────────────────────────────────────────────────────────
#  Cookie persistence
# ─────────────────────────────────────────────────────────────────────────────

def _get_session_cookie(driver: uc.Chrome) -> Optional[str]:
    """
    Return the value of Instagram's 'sessionid' cookie, or None.
    'sessionid' is the ONLY reliable auth signal — if it exists and is
    non-empty, the user is logged in. URL checks are unreliable because
    Instagram's homepage URL is the same whether logged in or not.
    """
    try:
        cookies = driver.get_cookies()
        for c in cookies:
            if c.get("name") == "sessionid" and c.get("value"):
                return c["value"]
    except Exception:
        pass
    return None


def is_logged_in(driver: uc.Chrome) -> bool:
    """
    True only when the browser holds a valid 'sessionid' cookie.
    Navigates to instagram.com first so the cookie domain is accessible.
    """
    try:
        if "instagram.com" not in driver.current_url:
            driver.get("https://www.instagram.com/")
            time.sleep(3)
        session = _get_session_cookie(driver)
        if session:
            log.info("Session valid — sessionid cookie present.")
            return True
        log.info("No sessionid cookie found — not logged in.")
        return False
    except Exception as exc:
        log.debug("is_logged_in error: %s", exc)
        return False


def save_cookies(driver: uc.Chrome) -> None:
    """Persist all current browser cookies to disk."""
    try:
        cookies = driver.get_cookies()
        with open(config.COOKIES_FILE, "w", encoding="utf-8") as f:
            json.dump(cookies, f, indent=2)
        # Confirm sessionid was captured
        names = [c["name"] for c in cookies]
        if "sessionid" in names:
            log.info("Cookies saved (%d total, sessionid ✓) → %s",
                     len(cookies), config.COOKIES_FILE)
        else:
            log.warning("Cookies saved but 'sessionid' is MISSING — "
                        "session may not restore correctly.")
    except Exception as exc:
        log.error("Failed to save cookies: %s", exc)


def load_cookies(driver: uc.Chrome) -> bool:
    """
    Inject saved cookies into the browser.
    Must be called AFTER navigating to instagram.com (cookie domain restriction).
    Returns True if sessionid was found and injected.
    """
    if not Path(config.COOKIES_FILE).exists():
        log.info("No cookie file at %s — skipping restore.", config.COOKIES_FILE)
        return False
    try:
        with open(config.COOKIES_FILE, encoding="utf-8") as f:
            cookies = json.load(f)

        if not cookies:
            log.warning("Cookie file is empty.")
            return False

        # Must be on instagram.com domain to set its cookies
        if "instagram.com" not in driver.current_url:
            driver.get("https://www.instagram.com/")
            time.sleep(3)

        injected = 0
        for cookie in cookies:
            try:
                # Remove fields that cause WebDriver to reject the cookie
                cookie.pop("sameSite", None)
                cookie.pop("storeId", None)
                driver.add_cookie(cookie)
                injected += 1
            except Exception as e:
                log.debug("Skipped cookie '%s': %s", cookie.get("name"), e)

        log.info("Injected %d/%d cookies — refreshing page …", injected, len(cookies))
        driver.refresh()
        time.sleep(4)

        # Verify sessionid is now in the browser
        session = _get_session_cookie(driver)
        if session:
            log.info("Cookie restore successful — sessionid active.")
            return True
        else:
            log.warning("Cookie restore failed — sessionid not found after inject.")
            return False

    except Exception as exc:
        log.error("Cookie load error: %s", exc)
        return False


# ─────────────────────────────────────────────────────────────────────────────
#  Login management
# ─────────────────────────────────────────────────────────────────────────────

def manual_login(driver: uc.Chrome) -> None:
    """
    Open Instagram login page and poll for the sessionid cookie.
    Saves cookies as soon as sessionid appears (works with 2FA too).
    """
    log.info("Opening Instagram for manual login …")

    # Warm up on homepage first (more human-like)
    driver.get("https://www.instagram.com/")
    time.sleep(random.uniform(3, 5))
    driver.get("https://www.instagram.com/accounts/login/")
    time.sleep(random.uniform(2, 3))

    print("\n" + "=" * 68)
    print("  ACTION REQUIRED — Manual Instagram Login")
    print("  ─────────────────────────────────────────────────────────────")
    print("  1. Enter your username and password in the browser window.")
    print("  2. Complete 2FA / verification if prompted.")
    print("  3. Once you reach your feed, the script continues automatically.")
    print(f"  (Waiting up to {config.LOGIN_WAIT_TIMEOUT // 60} minutes)")
    print("=" * 68 + "\n")

    deadline = time.time() + config.LOGIN_WAIT_TIMEOUT
    while time.time() < deadline:
        # Poll for sessionid cookie — appears the moment login completes
        session = _get_session_cookie(driver)
        if session:
            log.info("Login detected — sessionid cookie appeared.")
            time.sleep(3)   # let the page fully settle
            save_cookies(driver)
            log.info("Cookies saved. Automatic login will work on next run.")
            return
        time.sleep(2)

    raise RuntimeError(
        f"Login timeout: did not detect sessionid within "
        f"{config.LOGIN_WAIT_TIMEOUT // 60} minutes."
    )


def ensure_logged_in(driver: uc.Chrome) -> None:
    """
    Guarantee an authenticated Instagram session in this order:
      1. Try loading saved cookies from disk → check sessionid
      2. If that fails → prompt manual login → save cookies
    Always verifies via sessionid cookie, never via URL checks.
    """
    log.info("Checking Instagram session …")

    # ── Step 1: Try cookie restore ─────────────────────────────────────
    if Path(config.COOKIES_FILE).exists():
        log.info("Found cookie file — attempting restore …")
        if load_cookies(driver):
            log.info("Auto-login successful via saved cookies ✓")
            return
        log.warning("Cookie restore failed (cookies may have expired).")
        # Remove the stale file so next run goes straight to manual login
        try:
            os.remove(config.COOKIES_FILE)
            log.info("Deleted expired cookie file.")
        except Exception:
            pass
    else:
        log.info("No cookie file found — manual login required.")

    # ── Step 2: Manual login ───────────────────────────────────────────
    manual_login(driver)

    if not is_logged_in(driver):
        raise RuntimeError(
            "Authentication failed: sessionid cookie not found after login. "
            "Please try again."
        )


def check_for_rate_limit(driver: uc.Chrome) -> bool:
    """Return True if Instagram is showing a rate-limit / challenge page."""
    try:
        body = driver.find_element(By.TAG_NAME, "body").text.lower()
        signals = [
            "try again later",
            "please wait a few minutes",
            "we restrict certain activity",
            "action blocked",
            "challenge_required",
        ]
        for sig in signals:
            if sig in body:
                log.warning("Rate-limit signal detected: '%s'", sig)
                return True
    except Exception:
        pass
    return False


# ─────────────────────────────────────────────────────────────────────────────
#  URL utilities
# ─────────────────────────────────────────────────────────────────────────────

_SHORTCODE_RE = re.compile(
    r"instagram\.com/(?:p|reel|tv|reels)/([A-Za-z0-9_\-]+)"
)


def extract_shortcode(url: str) -> Optional[str]:
    """Extract the shortcode from any standard Instagram post/reel URL."""
    m = _SHORTCODE_RE.search(url)
    return m.group(1) if m else None


def normalise_url(url: str) -> str:
    """Return a canonical, query-free Instagram URL."""
    url = str(url).strip().split("?")[0].rstrip("/")
    if not url.startswith("http"):
        url = "https://www.instagram.com/" + url.lstrip("/")
    return url


# ─────────────────────────────────────────────────────────────────────────────
#  Number parsing
# ─────────────────────────────────────────────────────────────────────────────

def parse_number(text: Optional[str]) -> Optional[int]:
    """
    Convert human-readable counts like '1.2K', '3.5M', '1,234' → int.
    Returns None on failure.
    """
    if not text:
        return None
    text = unicodedata.normalize("NFKD", str(text)).strip()
    text = text.replace(",", "").replace(" ", "").replace(" ", "")
    multipliers = {"K": 1_000, "M": 1_000_000, "B": 1_000_000_000}
    for suffix, mult in multipliers.items():
        if text.upper().endswith(suffix):
            try:
                return int(float(text[:-1]) * mult)
            except ValueError:
                return None
    cleaned = re.sub(r"[^\d.]", "", text)
    try:
        return int(float(cleaned)) if cleaned else None
    except ValueError:
        return None


# ─────────────────────────────────────────────────────────────────────────────
#  Extraction Strategy A — Relay JSON embedded in <script> tags  ← PRIMARY
# ─────────────────────────────────────────────────────────────────────────────

def strategy_relay_json(soup: BeautifulSoup, shortcode: str) -> Dict[str, Any]:
    """
    PRIMARY strategy. Extracts likes, comments from Instagram's embedded
    Relay JSON blob AND returns the media pk so the caller can fetch play_count
    via the media info API.

    Debug finding: play_count is NOT in the embedded script — it's loaded
    dynamically by the video player. But pk IS here, enabling the API call.
    """
    result: Dict[str, Any] = {}

    metric_patterns = {
        "likes":    [r'"like_count"\s*:\s*(\d+)',    r'"likes"\s*:\s*(\d+)'],
        "comments": [r'"comment_count"\s*:\s*(\d+)', r'"comments"\s*:\s*(\d+)'],
        "shares":   [r'"reshare_count"\s*:\s*(\d+)', r'"share_count"\s*:\s*(\d+)'],
    }

    for script in soup.find_all("script"):
        raw = script.string or ""
        if shortcode not in raw:
            continue

        found_any = False
        for metric, patterns in metric_patterns.items():
            if metric in result:
                continue
            for pat in patterns:
                m = re.search(pat, raw)
                if m:
                    try:
                        result[metric] = int(m.group(1))
                        found_any = True
                        break
                    except ValueError:
                        pass

        # Extract media pk (needed for media info API → play_count)
        if found_any and "_pk" not in result:
            idx = raw.find(f'"code":"{shortcode}"')
            if idx == -1:
                idx = raw.find(shortcode)
            snippet = raw[idx: idx + 300] if idx != -1 else raw[:300]
            pk_m = re.search(r'"pk"\s*:\s*"(\d+)"', snippet)
            if pk_m:
                result["_pk"] = pk_m.group(1)   # internal key, not written to sheet

        if found_any:
            log.info("Relay JSON → likes=%s comments=%s shares=%s pk=%s",
                     result.get("likes"), result.get("comments"),
                     result.get("shares"), result.get("_pk"))
            break

    return result


def strategy_media_api(pk: str) -> Dict[str, Any]:
    """
    Call Instagram's internal /api/v1/media/{pk}/info/ using the requests
    library with an Instagram mobile user-agent + saved session cookies.

    Why requests instead of the browser:
      - Browser UA → "useragent mismatch" error (confirmed in debug)
      - Mobile UA via requests → returns full JSON with play_count ✓
      - Faster: no browser navigation, no page render wait

    Returns likes, comments, AND views (play_count) — all three in one call.
    """
    import requests as req

    result: Dict[str, Any] = {}
    if not pk:
        return result

    if not Path(config.COOKIES_FILE).exists():
        log.debug("No cookie file — skipping media API.")
        return result

    try:
        with open(config.COOKIES_FILE, encoding="utf-8") as f:
            raw_cookies = json.load(f)
        cookies_dict = {c["name"]: c["value"] for c in raw_cookies}

        headers = {
            # Instagram Android app user-agent — required by this endpoint
            "User-Agent": (
                "Instagram 319.0.0.0.0 Android (26/8.0.0; 480dpi; 1080x1920; "
                "Samsung; SM-G991B; samsung; exynos2100; en_US; 314665256)"
            ),
            "X-IG-App-ID":    "936619743392459",
            "X-IG-WWW-Claim": "0",
            "Accept":         "*/*",
            "Accept-Language": "en-US,en;q=0.9",
        }

        resp = req.get(
            f"https://www.instagram.com/api/v1/media/{pk}/info/",
            cookies=cookies_dict,
            headers=headers,
            timeout=15,
        )

        if resp.status_code != 200:
            log.debug("Media API HTTP %s for pk=%s", resp.status_code, pk)
            return result

        data  = resp.json()
        items = data.get("items") or []
        if not items or data.get("status") != "ok":
            log.debug("Media API returned no items for pk=%s", pk)
            return result

        media = items[0]

        play_count = (
            media.get("play_count")
            or media.get("ig_play_count")
            or media.get("video_view_count")
            or (media.get("clips_metadata") or {}).get("play_count")
        )
        if play_count is not None:
            result["views"] = int(play_count)

        # likes, comments, shares also confirmed here (overrides Relay JSON if present)
        if media.get("like_count") is not None:
            result["likes"]    = int(media["like_count"])
        if media.get("comment_count") is not None:
            result["comments"] = int(media["comment_count"])
        reshare = media.get("reshare_count") or media.get("share_count")
        if reshare is not None:
            result["shares"] = int(reshare)

        log.info(
            "Media API  → views=%s likes=%s comments=%s shares=%s",
            result.get("views"), result.get("likes"),
            result.get("comments"), result.get("shares"),
        )

    except Exception as exc:
        log.debug("Media API failed for pk=%s: %s", pk, exc)

    return result


# ─────────────────────────────────────────────────────────────────────────────
#  Extraction Strategy B — JSON-LD structured data
# ─────────────────────────────────────────────────────────────────────────────

def strategy_json_ld(soup: BeautifulSoup) -> Dict[str, Any]:
    """
    Parse interactionStatistic blocks from JSON-LD <script> tags.
    Instagram includes these for posts (not always for reels).
    """
    result: Dict[str, Any] = {}
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            raw = script.string or ""
            data = json.loads(raw)
            if isinstance(data, list):
                data = data[0] if data else {}
            schema_type = data.get("@type", "")
            if schema_type not in ("SocialMediaPosting", "VideoObject", "CreativeWork"):
                continue
            for stat in data.get("interactionStatistic", []):
                itype = stat.get("interactionType", "")
                count = stat.get("userInteractionCount")
                if count is None:
                    continue
                try:
                    count = int(count)
                except (ValueError, TypeError):
                    continue
                if "LikeAction" in itype:
                    result["likes"] = count
                elif "CommentAction" in itype:
                    result["comments"] = count
                elif "WatchAction" in itype or "ViewAction" in itype:
                    result["views"] = count
        except (json.JSONDecodeError, AttributeError, KeyError):
            continue
    if result:
        log.info("JSON-LD  → %s", result)
    return result


# ─────────────────────────────────────────────────────────────────────────────
#  Extraction Strategy C — DOM aria-label scraping
# ─────────────────────────────────────────────────────────────────────────────

def strategy_dom(driver: uc.Chrome, soup: BeautifulSoup) -> Dict[str, Any]:
    """
    Fallback: scrape aria-labels and page text.
    Reel pages show numbers without labels so we also try aria-label attributes
    on the like/comment buttons which are more reliable than raw text.
    """
    result: Dict[str, Any] = {}
    page_text = ""

    try:
        page_text = driver.find_element(By.TAG_NAME, "body").text
    except Exception:
        page_text = soup.get_text(separator=" ")

    # ── Likes via aria-label ───────────────────────────────────────────
    try:
        for sel in ["button[aria-label*='like']", "span[aria-label*='like']",
                    "button[aria-label*='Like']"]:
            els = driver.find_elements(By.CSS_SELECTOR, sel)
            for el in els:
                label = el.get_attribute("aria-label") or ""
                nums  = re.findall(r"[\d,]+", label)
                if nums:
                    val = parse_number(nums[0])
                    if val is not None:
                        result["likes"] = val
                        break
            if "likes" in result:
                break
    except Exception:
        pass

    # ── Likes / Comments via labelled text ────────────────────────────
    like_pats = [r"([\d,.KMBkmb]+)\s+(?:likes?|people\s+like)",
                 r"Liked\s+by\s+\w+\s+and\s+([\d,.KMBkmb]+)\s+others"]
    for pat in like_pats:
        if "likes" in result:
            break
        m = re.search(pat, page_text, re.I)
        if m:
            val = parse_number(m.group(1))
            if val is not None:
                result["likes"] = val

    comment_pats = [r"([\d,.KMBkmb]+)\s+comments?",
                    r"View\s+all\s+([\d,.KMBkmb]+)\s+comments?",
    ]
    for pat in comment_pats:
        m = re.search(pat, page_text, re.I)
        if m:
            val = parse_number(m.group(1))
            if val is not None:
                result["comments"] = val
                break

    # ── Views (video / reel) ──────────────────────────────────────────────
    view_patterns = [
        r"([\d,.KMBkmb]+)\s+(?:views?|plays?)",
        r"(?:views?|plays?)\s*[:\-]?\s*([\d,.KMBkmb]+)",
    ]
    for pat in view_patterns:
        m = re.search(pat, page_text, re.I)
        if m:
            val = parse_number(m.group(1))
            if val is not None:
                result["views"] = val
                break

    if result:
        log.info("DOM      → %s", result)
    return result


# ─────────────────────────────────────────────────────────────────────────────
#  Master scrape function (all strategies combined)
# ─────────────────────────────────────────────────────────────────────────────

def scrape_post(
    driver: uc.Chrome,
    url: str,
    content_type: str,
) -> Dict[str, Any]:
    """
    Scrape a single Instagram post/reel URL.
    Tries GraphQL → JSON-LD → DOM in order; merges any partial results.
    Returns a dict with keys: likes, comments, views, shares, shortcode.
    Missing/unavailable values are None.
    """
    shortcode = extract_shortcode(url)
    metrics: Dict[str, Any] = {
        "likes":     None,
        "comments":  None,
        "views":     None,
        "shares":    None,
        "shortcode": shortcode,
    }

    if not shortcode:
        log.error("Cannot extract shortcode from URL: %s", url)
        return metrics

    # Navigate directly to the post/reel page.
    # Relay JSON (Strategy A) is extracted from THIS page's source — no extra
    # navigation needed. The old GraphQL /?__a=1 endpoint is dropped because
    # it returns "page not available" for reels.
    canon_url = normalise_url(url)
    page_loaded = False
    try:
        driver.get(canon_url)
        # With eager strategy, this returns fast; just wait for article/main
        WebDriverWait(driver, config.ELEMENT_WAIT_TIMEOUT).until(
            EC.any_of(
                EC.presence_of_element_located((By.TAG_NAME, "article")),
                EC.presence_of_element_located((By.CSS_SELECTOR, "main")),
                EC.presence_of_element_located((By.TAG_NAME, "body")),
            )
        )
        page_loaded = True
        time.sleep(random.uniform(2, 3))

    except TimeoutException:
        # Eager strategy means DOM may still be usable even after timeout
        log.warning("Page load timed out for %s — attempting partial parse.", url)
        page_loaded = True   # browser has partial DOM, still worth trying

    except WebDriverException as exc:
        log.error("WebDriver error navigating to %s: %s", url, exc)

    if page_loaded:
        try:
            # Check for login redirect
            if "accounts/login" in driver.current_url:
                log.warning("Redirected to login for %s — session may have expired.", url)
                return metrics

            # Check for rate-limit
            if check_for_rate_limit(driver):
                backoff = random.uniform(60, 120)
                log.warning("Rate-limit hit — sleeping %.0f s …", backoff)
                time.sleep(backoff)
                driver.get(canon_url)
                time.sleep(random.uniform(3, 5))

            soup = BeautifulSoup(driver.page_source, "html.parser")

            # ── Strategy A: Relay JSON (likes, comments, pk) ─────────────
            relay = strategy_relay_json(soup, shortcode)
            media_pk = relay.pop("_pk", None)        # extract pk, don't write to sheet
            for k, v in relay.items():
                if metrics.get(k) is None and v is not None:
                    metrics[k] = v

            # ── Strategy A2: Media Info API (views + confirm likes/comments) ─
            # Uses requests + mobile UA — no browser navigation needed.
            # This is the ONLY reliable source for Reel play_count.
            if media_pk:
                api = strategy_media_api(media_pk)
                for k, v in api.items():
                    if metrics.get(k) is None and v is not None:
                        metrics[k] = v

            # ── Strategy B: JSON-LD (posts only, fallback) ───────────────
            if not all(metrics.get(k) is not None for k in ("likes", "comments")):
                jld = strategy_json_ld(soup)
                for k, v in jld.items():
                    if metrics.get(k) is None and v is not None:
                        metrics[k] = v

            # ── Strategy C: DOM aria-label (last resort) ──────────────────
            if not all(metrics.get(k) is not None for k in ("likes", "comments")):
                dom = strategy_dom(driver, soup)
                for k, v in dom.items():
                    if metrics.get(k) is None and v is not None:
                        metrics[k] = v

        except WebDriverException as exc:
            log.error("WebDriver error extracting data from %s: %s", url, exc)

    log.info(
        "Result [%s] likes=%s | comments=%s | views=%s",
        shortcode,
        metrics["likes"],
        metrics["comments"],
        metrics["views"],
    )
    return metrics


# ─────────────────────────────────────────────────────────────────────────────
#  Google Sheets helpers
# ─────────────────────────────────────────────────────────────────────────────

def open_spreadsheet() -> pygsheets.Spreadsheet:
    gc = pygsheets.authorize(service_file=config.SERVICE_ACCOUNT_FILE)
    return gc.open(config.SPREADSHEET_NAME)


def ensure_sheets_exist(sh: pygsheets.Spreadsheet) -> None:
    """Create input / tracking_data worksheets with headers if missing."""
    existing = [ws.title for ws in sh.worksheets()]

    if config.INPUT_SHEET_TITLE not in existing:
        ws = sh.add_worksheet(config.INPUT_SHEET_TITLE, rows=1000, cols=10)
        ws.update_row(
            1,
            ["post_url", "creator_name", "content_type", "active"],
        )
        log.info("Created worksheet: '%s'", config.INPUT_SHEET_TITLE)

    if config.OUTPUT_SHEET_TITLE not in existing:
        ws = sh.add_worksheet(config.OUTPUT_SHEET_TITLE, rows=50000, cols=15)
        ws.update_row(
            1,
            [
                "scrape_time", "creator_name", "post_url", "shortcode",
                "content_type", "likes", "comments", "views", "shares",
            ],
        )
        log.info("Created worksheet: '%s'", config.OUTPUT_SHEET_TITLE)


def read_input_sheet(sh: pygsheets.Spreadsheet) -> pd.DataFrame:
    """
    Return a DataFrame of active posts from the input worksheet.
    Filters: active == TRUE/1/yes, post_url starts with http.
    Deduplicates on post_url.
    """
    ws = sh.worksheet_by_title(config.INPUT_SHEET_TITLE)
    df = ws.get_as_df(has_header=True)

    required = {"post_url", "creator_name", "content_type", "active"}
    missing  = required - set(df.columns)
    if missing:
        raise ValueError(
            f"Input sheet is missing required columns: {missing}\n"
            f"Found columns: {list(df.columns)}"
        )

    df["active"] = df["active"].astype(str).str.strip().str.lower()
    df = df[df["active"].isin(["true", "1", "yes", "y"])].copy()
    df = df[df["post_url"].astype(str).str.strip().str.startswith("http")].copy()
    df.drop_duplicates(subset=["post_url"], inplace=True)
    df.reset_index(drop=True, inplace=True)

    log.info("Input sheet: %d active posts loaded.", len(df))
    return df


OUTPUT_COLUMNS: List[str] = [
    "scrape_time",
    "creator_name",
    "post_url",
    "shortcode",
    "content_type",
    "likes",
    "comments",
    "views",
    "shares",
]

INDIVIDUAL_SHEET_COLUMNS: List[str] = [
    "date_time",
    "likes",         "likes_increased",
    "comments",      "comments_increased",
    "views",         "views_increased",
    "shares",        "shares_increased",
]


def append_to_tracking_sheet(
    sh: pygsheets.Spreadsheet,
    new_rows: List[Dict[str, Any]],
) -> None:
    """
    Append new_rows to the tracking_data sheet without overwriting history.
    Uses the pattern:  old_df + new_df → clear → rewrite full history.
    """
    ws      = sh.worksheet_by_title(config.OUTPUT_SHEET_TITLE)
    old_df  = ws.get_as_df(has_header=True)
    new_df  = pd.DataFrame(new_rows, columns=OUTPUT_COLUMNS)

    if old_df.empty or list(old_df.columns) != OUTPUT_COLUMNS:
        final_df = new_df
    else:
        final_df = pd.concat([old_df, new_df], ignore_index=True)

    ws.clear()
    ws.set_dataframe(final_df, (1, 1), copy_head=True)
    log.info(
        "Tracking sheet updated — %d new rows | %d total rows.",
        len(new_df),
        len(final_df),
    )


# ─────────────────────────────────────────────────────────────────────────────
#  Per-video individual sheets
# ─────────────────────────────────────────────────────────────────────────────

def ensure_individual_sheet(
    sh: pygsheets.Spreadsheet,
    shortcode: str,
) -> pygsheets.Worksheet:
    """
    Return the worksheet named after the shortcode, creating it with a
    header row if it doesn't already exist.
    """
    existing = [ws.title for ws in sh.worksheets()]
    if shortcode not in existing:
        ws = sh.add_worksheet(shortcode, rows=10000, cols=10)
        ws.update_row(1, INDIVIDUAL_SHEET_COLUMNS)
        log.info("Created individual sheet: '%s'", shortcode)
    else:
        ws = sh.worksheet_by_title(shortcode)
    return ws


def append_to_individual_sheet(
    sh: pygsheets.Spreadsheet,
    shortcode: str,
    scrape_time: str,
    likes: Optional[int],
    comments: Optional[int],
    views: Optional[int],
    shares: Optional[int],
) -> None:
    """
    Append one timestamped row to the per-video sheet.
    The *_increased columns show the delta vs. the previous row.
    First row gets 0 for all deltas (no previous baseline).
    """
    ws = ensure_individual_sheet(sh, shortcode)
    existing_df = ws.get_as_df(has_header=True)

    def delta(current: Optional[int], col: str) -> Optional[int]:
        """Return current - previous, or None if either value is missing."""
        if current is None:
            return None
        if existing_df.empty:
            return 0   # first row — no previous data
        try:
            raw = str(existing_df.iloc[-1][col]).strip()
            if raw in ("", "None", "nan"):
                return None
            return current - int(float(raw))
        except (ValueError, TypeError, KeyError):
            return None

    new_row = [
        scrape_time,
        likes,    delta(likes,    "likes"),
        comments, delta(comments, "comments"),
        views,    delta(views,    "views"),
        shares,   delta(shares,   "shares"),
    ]

    next_row = len(existing_df) + 2   # +1 for header, +1 for 1-based index
    ws.update_row(next_row, new_row)

    log.info(
        "Individual [%s] → likes=%s(+%s) comments=%s(+%s) "
        "views=%s(+%s) shares=%s(+%s)",
        shortcode,
        likes,    delta(likes,    "likes"),
        comments, delta(comments, "comments"),
        views,    delta(views,    "views"),
        shares,   delta(shares,   "shares"),
    )


# ─────────────────────────────────────────────────────────────────────────────
#  Main tracking job
# ─────────────────────────────────────────────────────────────────────────────

def run_tracking_job(
    driver: uc.Chrome,
    sh: pygsheets.Spreadsheet,
) -> None:
    """
    Full tracking pass: read inputs → scrape → write to Sheets.
    Called once immediately on startup, then on every scheduled tick.
    """
    log.info("═" * 65)
    log.info(
        "Tracking job started  —  %s",
        datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    )

    # Re-validate session before each run
    if not is_logged_in(driver):
        log.warning("Session expired — re-authenticating …")
        ensure_logged_in(driver)

    # ── Read inputs ───────────────────────────────────────────────────────
    try:
        input_df = read_input_sheet(sh)
    except Exception as exc:
        log.error("Cannot read input sheet: %s", exc)
        return

    if input_df.empty:
        log.warning("Input sheet has no active rows — nothing to scrape.")
        return

    # ── Scrape each post ──────────────────────────────────────────────────
    new_rows: List[Dict[str, Any]] = []
    scrape_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    total = len(input_df)

    for idx, row in input_df.iterrows():
        url          = normalise_url(str(row["post_url"]).strip())
        creator      = str(row.get("creator_name", "")).strip()
        content_type = str(row.get("content_type", "post")).strip().lower()
        shortcode    = extract_shortcode(url)

        log.info(
            "[%d/%d]  %-50s  (%s)",
            idx + 1,
            total,
            url[:50],
            creator or "—",
        )

        # Retry loop
        metrics: Optional[Dict[str, Any]] = None
        for attempt in range(1, config.MAX_RETRIES + 1):
            try:
                metrics = scrape_post(driver, url, content_type)
                break
            except Exception as exc:
                log.warning(
                    "Attempt %d/%d failed for %s: %s",
                    attempt, config.MAX_RETRIES, url, exc,
                )
                if attempt < config.MAX_RETRIES:
                    log.info("Retrying in %d s …", config.RETRY_DELAY_SECONDS)
                    time.sleep(config.RETRY_DELAY_SECONDS)

        if metrics is None:
            log.error("All retries exhausted for %s — recording nulls.", url)
            metrics = {
                "likes": None, "comments": None, "views": None,
                "shares": None, "shortcode": shortcode,
            }

        post_shortcode = metrics.get("shortcode") or shortcode or ""

        new_rows.append(
            {
                "scrape_time":  scrape_time,
                "creator_name": creator,
                "post_url":     url,
                "shortcode":    post_shortcode,
                "content_type": content_type,
                "likes":        metrics.get("likes"),
                "comments":     metrics.get("comments"),
                "views":        metrics.get("views"),
                "shares":       metrics.get("shares"),
            }
        )

        # ── Write to per-video individual sheet ───────────────────────────
        if post_shortcode:
            try:
                append_to_individual_sheet(
                    sh,
                    post_shortcode,
                    scrape_time,
                    metrics.get("likes"),
                    metrics.get("comments"),
                    metrics.get("views"),
                    metrics.get("shares"),
                )
            except Exception as exc:
                log.error(
                    "Failed to write individual sheet for %s: %s",
                    post_shortcode, exc,
                )

        # Polite inter-post delay
        if idx < total - 1:
            delay = random.uniform(*config.BETWEEN_POSTS_DELAY)
            log.debug("Sleeping %.1f s …", delay)
            time.sleep(delay)

    # ── Write results ─────────────────────────────────────────────────────
    if new_rows:
        try:
            append_to_tracking_sheet(sh, new_rows)
        except Exception as exc:
            log.error(
                "Failed to write tracking sheet: %s\n%s",
                exc,
                traceback.format_exc(),
            )
    else:
        log.warning("No rows to write.")

    log.info(
        "Job finished — next run in %d min.",
        config.TRACKING_INTERVAL_MINUTES,
    )
    log.info("═" * 65)


# ─────────────────────────────────────────────────────────────────────────────
#  Entry point
# ─────────────────────────────────────────────────────────────────────────────

def main() -> None:
    log.info("Instagram Post Tracker  —  starting up")
    log.info("Interval : %d minutes", config.TRACKING_INTERVAL_MINUTES)
    log.info("Sheet    : %s", config.SPREADSHEET_NAME)
    log.info("Profile  : %s", config.PROFILE_DIR)

    # ── Google Sheets ────────────────────────────────────────────────────
    try:
        sh = open_spreadsheet()
        ensure_sheets_exist(sh)
        log.info("Google Spreadsheet '%s' opened.", config.SPREADSHEET_NAME)
    except FileNotFoundError:
        log.critical(
            "Service account file not found: %s\n"
            "See README.md → 'Google Service Account Setup'.",
            config.SERVICE_ACCOUNT_FILE,
        )
        sys.exit(1)
    except Exception as exc:
        log.critical("Cannot open Google Spreadsheet: %s", exc)
        sys.exit(1)

    # ── ChromeDriver ─────────────────────────────────────────────────────
    driver: Optional[uc.Chrome] = None
    try:
        driver = create_driver()
        ensure_logged_in(driver)

        # ── Run once immediately, then schedule ───────────────────────────
        run_tracking_job(driver, sh)

        schedule.every(config.TRACKING_INTERVAL_MINUTES).minutes.do(
            run_tracking_job, driver=driver, sh=sh
        )

        log.info(
            "Scheduler running — every %d min.  Press Ctrl+C to stop.",
            config.TRACKING_INTERVAL_MINUTES,
        )

        while True:
            schedule.run_pending()
            time.sleep(30)

    except KeyboardInterrupt:
        log.info("Interrupted by user — shutting down gracefully.")
    except SessionNotCreatedException as exc:
        log.critical(
            "ChromeDriver version mismatch: %s\n"
            "Run:  pip install --upgrade webdriver-manager",
            exc,
        )
    except Exception as exc:
        log.critical("Fatal error: %s\n%s", exc, traceback.format_exc())
        raise
    finally:
        if driver:
            try:
                driver.quit()
                log.info("ChromeDriver closed.")
            except Exception:
                pass


if __name__ == "__main__":
    main()
