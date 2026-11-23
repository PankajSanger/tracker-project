"""One-time Instagram login for the scraper's own Chrome profile (optional - only needed for views of OLDER reels).

Opens a visible Chrome window that uses the dedicated profile folder scraper/.chrome-profile (not your normal Chrome).
You log in yourself; the script never sees your password. The scraper's headless Chrome then reuses that profile,
so it browses Instagram like a logged-in visitor and can scroll creators' reels grids further back.

    ..\\venv\\Scripts\\python.exe ig_login.py           # log in
    ..\\venv\\Scripts\\python.exe ig_login.py --check   # is the profile still logged in?

Use a secondary Instagram account. Requests stay slow and few (a handful of pages per run), like a person browsing.
"""
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
PROFILE = os.path.join(HERE, ".chrome-profile")


def main() -> int:
    os.environ["CHROME_PROFILE_DIR"] = PROFILE
    check = "--check" in sys.argv
    if not check:
        os.environ["SELENIUM_HEADLESS"] = "0"
    import browser  # imported after the env is set

    driver = browser.get_driver()
    try:
        driver.get("https://www.instagram.com/" if check else "https://www.instagram.com/accounts/login/")
        if check:
            time.sleep(4)
            ok = any(c.get("name") == "sessionid" and c.get("value") for c in driver.get_cookies())
            print("Instagram profile is logged in." if ok else "Not logged in - run ig_login.py to log in.")
            return 0 if ok else 1
        print("Log in to Instagram in the Chrome window (you have 10 minutes). Close nothing; this window closes by itself.", flush=True)
        end = time.time() + 600
        while time.time() < end:
            if any(c.get("name") == "sessionid" and c.get("value") for c in driver.get_cookies()):
                time.sleep(4)  # let Instagram finish setting its cookies
                print("Logged in. The scraper will now use this session (profile folder: scraper/.chrome-profile).")
                return 0
            time.sleep(2)
        print("Timed out waiting for the login.")
        return 1
    finally:
        browser.close()


if __name__ == "__main__":
    sys.exit(main())
