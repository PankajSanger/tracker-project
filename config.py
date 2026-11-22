"""
config.py — Central configuration for Instagram Post Tracker.

Edit the values here (or override via environment variables) before
running instagram_tracker.py for the first time.
"""

import os

# ─────────────────────────────────────────────────────────────────────────────
#  Google Sheets
# ─────────────────────────────────────────────────────────────────────────────

# Path to the Google service-account JSON key file
SERVICE_ACCOUNT_FILE: str = os.getenv(
    "GOOGLE_SERVICE_ACCOUNT", "command-center-328013-4d781ba13148.json"
)

# Exact name of the Google Spreadsheet (as it appears in Google Drive)
SPREADSHEET_NAME: str = os.getenv(
    "SPREADSHEET_NAME", "tracking"
)

# Worksheet titles inside that spreadsheet
INPUT_SHEET_TITLE: str  = "input"
OUTPUT_SHEET_TITLE: str = "tracking_data"

# ─────────────────────────────────────────────────────────────────────────────
#  Tracking schedule
# ─────────────────────────────────────────────────────────────────────────────

# How often to scrape (in minutes).  60 = once per hour.
TRACKING_INTERVAL_MINUTES: int = int(
    os.getenv("TRACKING_INTERVAL_MINUTES", "60")
)

# ─────────────────────────────────────────────────────────────────────────────
#  Browser / Selenium
# ─────────────────────────────────────────────────────────────────────────────

# Leave blank to auto-manage ChromeDriver via webdriver-manager.
# Or set the full path, e.g. r"C:\chromedriver\chromedriver.exe"
CHROMEDRIVER_PATH: str = os.getenv("CHROMEDRIVER_PATH", "")

# Set to "true" to run Chrome headlessly (no visible window).
# NOTE: Instagram is harder to scrape headlessly; keep False unless needed.
HEADLESS_MODE: bool = os.getenv("HEADLESS_MODE", "false").lower() == "true"

# Directory where Chrome persists its user profile (login session, cookies).
# This is the MOST reliable way to keep your session across runs.
PROFILE_DIR: str = os.path.join(os.getcwd(), "chrome_profile")

# Fallback cookie file used when Chrome profile session is not available
COOKIES_FILE: str = "instagram_cookies.json"

# ─────────────────────────────────────────────────────────────────────────────
#  Timeouts & delays  (seconds unless noted)
# ─────────────────────────────────────────────────────────────────────────────

PAGE_LOAD_TIMEOUT: int    = 60    # full page load (eager strategy makes this a hard cap)
ELEMENT_WAIT_TIMEOUT: int = 15    # explicit element waits
LOGIN_WAIT_TIMEOUT: int   = 300   # manual login window (5 min)

MAX_RETRIES: int          = 3     # per-URL retry attempts
RETRY_DELAY_SECONDS: int  = 30    # wait between retries

# Random sleep between individual posts  (min, max) — mimics human browsing
BETWEEN_POSTS_DELAY: tuple = (6, 18)

# Random sleep after a full batch completes
BATCH_DELAY: tuple = (30, 60)

# ─────────────────────────────────────────────────────────────────────────────
#  Logging
# ─────────────────────────────────────────────────────────────────────────────

LOG_DIR: str   = "logs"
LOG_FILE: str  = os.path.join(LOG_DIR, "tracker.log")
LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")   # DEBUG | INFO | WARNING | ERROR
