"""Quick health check of the scrapers against well-known public pages. Writes nothing to the sheet.

    python selftest.py            (locally, or via the 'selftest' GitHub workflow)
Exit code 1 if any check fails.
"""
import logging
import os
import sys
import time

import browser
import instagram
import twitter
import youtube

logging.basicConfig(level=logging.WARNING)

CHECKS = [
    ("YouTube video", lambda: youtube.fetch_post("dQw4w9WgXcQ")),
    ("YouTube channel", lambda: youtube.fetch_profile("NASA")),
    ("X post", lambda: twitter.fetch_post("20", {"url": "https://x.com/jack/status/20"})),
    ("X profile", lambda: twitter.fetch_profile("NASA")),
    ("Instagram post", lambda: instagram.fetch_post("DbVW05gk_1i")),
    ("Instagram profile", lambda: instagram.fetch_profile("instagram")),
    ("Instagram views", lambda: _reel_views("instagram")),
]

# Profile pages (and the reels grid, which is a profile page) are login-walled for server IPs such as GitHub's.
SERVER_SKIP = {"X profile", "Instagram profile", "Instagram views"}


def _reel_views(user):
    instagram.grid_lookup(user, "__none__")
    items = instagram._grid[user]["items"]
    with_views = {k: v for k, v in items.items() if v.get("views")}
    if not with_views:
        raise RuntimeError("no reel views found on the reels grid")
    code, v = next(iter(with_views.items()))
    return {"reels_with_views": len(with_views), "example": {code: v}}


def main() -> int:
    failed = 0
    skipped = 0
    for name, fn in CHECKS:
        if os.getenv("CI") and name in SERVER_SKIP:
            skipped += 1
            print(f"SKIP {name:18} (login-walled for server IPs; runs on the PC)")
            continue
        t = time.time()
        try:
            print(f"OK   {name:18} {fn()}  ({time.time() - t:.0f}s)")
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"FAIL {name:18} {type(exc).__name__}: {str(exc)[:200]}  ({time.time() - t:.0f}s)")
    browser.close()
    ran = len(CHECKS) - skipped
    print(f"\n{ran - failed}/{ran} checks passed" + (f", {skipped} skipped" if skipped else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
