"""Local-only fallback for Instagram follower counts.

Instagram rate-limits the profile API (HTTP 429) far more than the post API. A real,
logged-in Chrome reading the profile page usually still works. This needs Chrome +
undetected-chromedriver (already in the project's venv) and a visible browser window,
so it only works when scrape.py runs on your own PC, not on GitHub Actions.

Enable with env IG_BROWSER_FALLBACK=1 (put it in scraper/.env).
"""
import os
import re
import time
from typing import Any, Dict, Optional

import instagram


def _chrome_major() -> Optional[int]:
    try:
        import winreg
        for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
            try:
                k = winreg.OpenKey(hive, r"Software\Google\Chrome\BLBeacon")
                return int(str(winreg.QueryValueEx(k, "version")[0]).split(".")[0])
            except OSError:
                continue
    except ImportError:
        pass
    return None


def _count(text: str) -> Optional[int]:
    m = re.match(r"([\d.,]+)\s*([KMB]?)", text.strip(), re.I)
    if not m:
        return None
    mult = {"": 1, "K": 1e3, "M": 1e6, "B": 1e9}[m.group(2).upper()]
    return int(round(float(m.group(1).replace(",", "")) * mult))


def fetch_profiles(handles: "list[str]") -> Dict[str, Dict[str, Any]]:
    """Return {handle: {followers, following, posts_count}} for the handles it could read."""
    import undetected_chromedriver as uc

    cookies = instagram._cookies()
    opts = uc.ChromeOptions()
    opts.page_load_strategy = "eager"
    opts.add_argument("--lang=en-US")
    opts.add_argument("--window-size=900,700")
    kw: Dict[str, Any] = {"options": opts}
    if _chrome_major():
        kw["version_main"] = _chrome_major()
    driver = uc.Chrome(**kw)
    out: Dict[str, Dict[str, Any]] = {}
    try:
        driver.get("https://www.instagram.com/")
        for name, value in cookies.items():
            driver.add_cookie({"name": name, "value": value, "domain": ".instagram.com", "path": "/"})
        for h in handles:
            driver.get(f"https://www.instagram.com/{h}/")
            deadline = time.time() + 20
            body = ""
            while time.time() < deadline:
                body = driver.find_element("tag name", "body").text
                if re.search(r"[\d.,KMB]+\s*followers", body, re.I):
                    break
                time.sleep(1)
            f = re.search(r"([\d.,]+[KMB]?)\s*followers", body, re.I)
            g = re.search(r"([\d.,]+[KMB]?)\s*following", body, re.I)
            p = re.search(r"([\d.,]+[KMB]?)\s*posts", body, re.I)
            if f:
                out[h.lower()] = {
                    "followers": _count(f.group(1)),
                    "following": _count(g.group(1)) if g else None,
                    "posts_count": _count(p.group(1)) if p else None,
                }
            time.sleep(3)
    finally:
        try:
            driver.quit()
        except Exception:  # noqa: BLE001
            pass
    return out
