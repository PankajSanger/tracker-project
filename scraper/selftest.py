"""Quick health check of the scrapers against well-known public pages. Writes nothing to the sheet.

    python selftest.py            (locally, or via the 'selftest' GitHub workflow)
Exit code 1 if any check fails.
"""
import logging
import sys
import time

import browser
import twitter
import youtube

logging.basicConfig(level=logging.WARNING)

CHECKS = [
    ("YouTube video", lambda: youtube.fetch_post("dQw4w9WgXcQ")),
    ("YouTube channel", lambda: youtube.fetch_profile("NASA")),
    ("X post", lambda: twitter.fetch_post("20", {"url": "https://x.com/jack/status/20"})),
    ("X profile", lambda: twitter.fetch_profile("NASA")),
]


def main() -> int:
    failed = 0
    for name, fn in CHECKS:
        t = time.time()
        try:
            print(f"OK   {name:16} {fn()}  ({time.time() - t:.0f}s)")
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"FAIL {name:16} {type(exc).__name__}: {str(exc)[:200]}  ({time.time() - t:.0f}s)")
    browser.close()
    print(f"\n{len(CHECKS) - failed}/{len(CHECKS)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
