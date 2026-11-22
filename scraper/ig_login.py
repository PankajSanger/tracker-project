"""One-time Instagram login helper.

Opens a Chrome window; YOU log in (this script never sees or types your password).
It then captures the session cookies, verifies they work, and saves them to
scraper/.env (git-ignored) so `python scrape.py` works locally. It also prints the
values to paste into GitHub Actions secrets.

    ..\\venv\\Scripts\\python.exe ig_login.py          # log in + save
    ..\\venv\\Scripts\\python.exe ig_login.py --check  # just verify the saved session

Use a secondary Instagram account - automated access can get accounts restricted.
"""
import os
import re
import sys
import time
from pathlib import Path

import requests

HERE = Path(__file__).parent
ENV_FILE = HERE / ".env"
sys.path.insert(0, str(HERE))
import instagram  # noqa: E402


def load_env() -> None:
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


def verify() -> str:
    """Return a short description of the endpoint that accepted the session, or raise."""
    cookies = instagram._cookies()
    web_ua = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        "X-IG-App-ID": "936619743392459",
        "X-Requested-With": "XMLHttpRequest",
    }
    media = f"https://www.instagram.com/api/v1/media/{instagram.shortcode_to_pk('DY_yMYJyPQE')}/info/"
    attempts = [
        ("current_user (web UA)", "https://www.instagram.com/api/v1/accounts/current_user/?edit=true", web_ua),
        ("current_user (app UA)", "https://www.instagram.com/api/v1/accounts/current_user/?edit=true", instagram.HEADERS),
        ("media info (app UA)", media, instagram.HEADERS),
        ("media info (web UA)", media, web_ua),
    ]
    results = []
    for name, url, hdr in attempts:
        r = requests.get(url, headers=hdr, cookies=cookies, timeout=20)
        results.append(f"{name}: HTTP {r.status_code}")
        if r.status_code == 200 and '"status":"ok"' in r.text.replace(" ", ""):
            return name
    raise instagram.AuthError("; ".join(results))


def chrome_major() -> "int | None":
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


def browser_login() -> dict:
    import undetected_chromedriver as uc

    opts = uc.ChromeOptions()
    opts.add_argument("--start-maximized")
    opts.add_argument("--lang=en-US")
    kw = {"options": opts}
    if chrome_major():
        kw["version_main"] = chrome_major()
    driver = uc.Chrome(**kw)
    try:
        driver.get("https://www.instagram.com/accounts/login/")
        print("Log in to Instagram in the Chrome window (you have 10 minutes; 2-factor / 'save login' prompts are fine)...")
        deadline = time.time() + 600
        last = 0
        while time.time() < deadline:
            cookies = {c["name"]: c["value"] for c in driver.get_cookies()}
            if time.time() - last > 60:
                last = time.time()
                print(f"  waiting for login... cookies seen: {sorted(cookies)[:6]}", flush=True)
            if cookies.get("sessionid"):
                time.sleep(3)  # let IG finish setting cookies
                return {c["name"]: c["value"] for c in driver.get_cookies()}
            time.sleep(2)
        raise TimeoutError("login not completed in time")
    finally:
        try:
            driver.quit()
        except Exception:  # noqa: BLE001
            pass


def main() -> int:
    if "--check" in sys.argv:
        load_env()
        try:
            print("Session OK - verified via " + verify())
            return 0
        except Exception as exc:  # noqa: BLE001
            print("Session NOT valid:", exc)
            return 1

    c = browser_login()
    for k, env in (("sessionid", "IG_SESSIONID"), ("csrftoken", "IG_CSRFTOKEN"), ("ds_user_id", "IG_DS_USER_ID")):
        os.environ[env] = c.get(k, "")
    lines = [f"{env}={os.environ[env]}" for env in ("IG_SESSIONID", "IG_CSRFTOKEN", "IG_DS_USER_ID")]
    existing = ENV_FILE.read_text(encoding="utf-8").splitlines() if ENV_FILE.exists() else []
    keep = [l for l in existing if not re.match(r"IG_(SESSIONID|CSRFTOKEN|DS_USER_ID)=", l)]
    ENV_FILE.write_text("\n".join(keep + lines) + "\n", encoding="utf-8")  # save first - never lose a login
    print(f"\nSession saved to {ENV_FILE} (git-ignored).", flush=True)
    try:
        user = verify()
    except Exception as exc:  # noqa: BLE001
        print("Saved, but could not verify yet:", exc)
        return 1
    print(f"Verified via {user}.")
    print("For the hourly GitHub job, add these as repository secrets: IG_SESSIONID, IG_CSRFTOKEN, IG_DS_USER_ID")
    print("(copy the values from the .env file; do not share them - they act as a password).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
