"""
debug_scrape.py
Run this to see exactly what the browser loads for a given Instagram URL.
It prints the GraphQL response, JSON-LD blocks, and the full visible page text.
"""

import json, time, random
from pathlib import Path
import undetected_chromedriver as uc
from bs4 import BeautifulSoup
from selenium.webdriver.common.by import By
import config

TEST_URL   = "https://www.instagram.com/reels/DY0ADvpTFV2"
SHORTCODE  = "DY0ADvpTFV2"

# ── Boot driver ──────────────────────────────────────────────────────────────
opts = uc.ChromeOptions()
opts.page_load_strategy = "eager"
opts.add_argument("--start-maximized")
opts.add_argument("--lang=en-US")
opts.add_argument("--disable-notifications")

import winreg, re
def chrome_ver():
    for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
        for sub in (r"Software\Google\Chrome\BLBeacon",
                    r"Software\Wow6432Node\Google\Chrome\BLBeacon"):
            try:
                k = winreg.OpenKey(hive, sub)
                v, _ = winreg.QueryValueEx(k, "version")
                winreg.CloseKey(k)
                return int(str(v).split(".")[0])
            except OSError:
                continue
    return None

ver = chrome_ver()
print(f"Chrome major: {ver}")
driver = uc.Chrome(options=opts, version_main=ver)
driver.set_page_load_timeout(60)

# ── Load cookies ──────────────────────────────────────────────────────────────
print("\n── Loading cookies ──")
driver.get("https://www.instagram.com/")
time.sleep(3)
with open(config.COOKIES_FILE, encoding="utf-8") as f:
    cookies = json.load(f)
for c in cookies:
    c.pop("sameSite", None)
    c.pop("storeId", None)
    try:
        driver.add_cookie(c)
    except Exception:
        pass
driver.refresh()
time.sleep(4)

# Confirm session
session = next((c["value"] for c in driver.get_cookies() if c["name"] == "sessionid"), None)
print(f"sessionid present: {bool(session)}")

def p(text):
    """Print safely on Windows (strip non-cp1252 chars)."""
    print(text.encode("cp1252", errors="replace").decode("cp1252"))

# ── Strategy A: GraphQL ───────────────────────────────────────────────────────
p("\n=== Strategy A: GraphQL endpoint ===")
gql_url = f"https://www.instagram.com/p/{SHORTCODE}/?__a=1&__d=dis"
driver.get(gql_url)
time.sleep(3)
body = driver.find_element(By.TAG_NAME, "body").text[:2000]
p(f"URL after navigation : {driver.current_url}")
p(f"Body (first 2000 chars):\n{body}\n")

# ── Navigate to reel page ─────────────────────────────────────────────────────
p(f"\n=== Navigating to reel: {TEST_URL} ===")
driver.get(TEST_URL)
time.sleep(5)
p(f"Final URL: {driver.current_url}")

# ── Strategy B: JSON-LD ───────────────────────────────────────────────────────
p("\n=== Strategy B: JSON-LD blocks ===")
soup = BeautifulSoup(driver.page_source, "html.parser")
ld_scripts = soup.find_all("script", type="application/ld+json")
p(f"Found {len(ld_scripts)} JSON-LD blocks")
for i, s in enumerate(ld_scripts):
    p(f"  Block {i+1}: {(s.string or '(empty)')[:400]}")

# ── Strategy C: Page visible text ────────────────────────────────────────────
p("\n=== Strategy C: Full visible page text (first 3000 chars) ===")
page_text = driver.find_element(By.TAG_NAME, "body").text
p(page_text[:3000])

# ── All script tags containing metric keywords ────────────────────────────────
p("\n=== Script tags containing like/view/comment counts ===")
all_scripts = soup.find_all("script")
found = 0
for s in all_scripts:
    txt = s.string or ""
    if any(k in txt.lower() for k in ["like_count", "comment_count", "view_count", "play_count"]):
        p(f"  FOUND in script tag (first 600 chars):\n  {txt[:600]}\n")
        found += 1
if found == 0:
    p("  None found.")

p("\n=== Done ===")
input("Press Enter to close browser...")
driver.quit()
