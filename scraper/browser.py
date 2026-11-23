"""Shared headless Chrome (Selenium) used by the YouTube and X scrapers.

One browser is started lazily and reused for the whole run, then closed by `close()`.
Selenium 4's built-in Selenium Manager downloads a matching chromedriver automatically, so no manual
driver setup is needed locally or on GitHub Actions (ubuntu runners ship with Chrome).

Set SELENIUM_HEADLESS=0 to watch the browser while debugging.
"""
import atexit
import logging
import os
import time
from typing import Callable, Optional

from bs4 import BeautifulSoup
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.remote.webdriver import WebDriver

log = logging.getLogger("browser")
_driver: Optional[WebDriver] = None

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)


def get_driver() -> WebDriver:
    global _driver
    if _driver is not None:
        return _driver
    opts = Options()
    if os.getenv("SELENIUM_HEADLESS", "1") != "0":
        opts.add_argument("--headless=new")
    opts.add_argument("--window-size=1366,900")
    opts.add_argument("--lang=en-US")
    opts.add_argument(f"--user-agent={UA}")
    opts.add_argument("--disable-notifications")
    opts.add_argument("--disable-blink-features=AutomationControlled")
    opts.add_argument("--mute-audio")
    if os.getenv("CI"):  # GitHub Actions / containers
        opts.add_argument("--no-sandbox")
        opts.add_argument("--disable-dev-shm-usage")
    opts.page_load_strategy = "eager"  # don't wait for every image/ad to finish
    opts.add_experimental_option("excludeSwitches", ["enable-automation"])
    opts.add_experimental_option("prefs", {"intl.accept_languages": "en-US,en"})
    log.info("starting headless Chrome")
    _driver = webdriver.Chrome(options=opts)
    _driver.set_page_load_timeout(45)
    atexit.register(close)
    return _driver


def close() -> None:
    global _driver
    if _driver is not None:
        try:
            _driver.quit()
        except Exception:  # noqa: BLE001
            pass
        _driver = None


def soup_of(driver: WebDriver) -> BeautifulSoup:
    return BeautifulSoup(driver.page_source, "lxml")


def wait_for(driver: WebDriver, ready: Callable[[BeautifulSoup], bool], timeout: float = 15, poll: float = 0.7) -> BeautifulSoup:
    """Re-parse the page with Beautiful Soup until `ready(soup)` is true (or the timeout passes). Returns the last soup."""
    end = time.time() + timeout
    soup = soup_of(driver)
    while not ready(soup) and time.time() < end:
        time.sleep(poll)
        soup = soup_of(driver)
    return soup
