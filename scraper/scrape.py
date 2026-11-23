"""One scrape pass over the Google Sheet.

Reads active posts/accounts from the sheet tabs (st_posts, st_accounts), fetches current
numbers from Instagram / X / YouTube, and writes snapshots + a per-post summary back.

Run by GitHub Actions on a cron; also runnable locally:
    python scrape.py            (secrets are read from scraper/.env or the environment)
"""
import json
import logging
import os
import random
import sys
import time
from datetime import datetime, timedelta, timezone

_envf = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
if os.path.exists(_envf):  # local runs: load secrets from scraper/.env (git-ignored)
    for _l in open(_envf, encoding="utf-8").read().splitlines():
        if "=" in _l and not _l.lstrip().startswith("#"):
            _k, _v = _l.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip())

for _s in (sys.stdout, sys.stderr):  # emoji in captions must not crash Windows consoles
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass

import alerts  # noqa: E402
import browser  # noqa: E402
import instagram  # noqa: E402
import twitter  # noqa: E402
import youtube  # noqa: E402
from sheets_store import SheetsStore, num, truthy  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("scrape")

SPIKE_PCT = float(os.getenv("ALERT_SPIKE_PCT", "25"))  # % change between runs
SPIKE_MIN = int(os.getenv("ALERT_SPIKE_MIN", "50"))    # ...and at least this many
spike_pct, spike_min = SPIKE_PCT, SPIKE_MIN            # overridden by the dashboard settings in main()
DEFAULT_INTERVAL = {"instagram": 180, "twitter": 60, "youtube": 60}  # minutes; changeable in the dashboard
FORCE = os.getenv("FORCE") == "1"                      # manual runs ignore the interval
HIST_HOURS = 60                                        # recent points kept per post for 24h deltas
MAX_RETRIES = 2
MODULES = {"instagram": instagram, "twitter": twitter, "youtube": youtube}
METRICS = ("likes", "comments", "views", "shares")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def with_retries(fn, *args):
    for attempt in range(MAX_RETRIES + 1):
        try:
            return fn(*args)
        except (instagram.AuthError, instagram.RateLimited):
            raise
        except Exception as exc:  # noqa: BLE001
            if exc.__class__.__module__.startswith("selenium"):
                browser.close()  # a crashed/hung Chrome is restarted on the next attempt
            permanent = any(k in str(exc).lower() for k in ("unavailable", "not found", "doesn't exist", "suspended", "not readable"))
            if attempt == MAX_RETRIES or permanent:
                raise
            log.warning("retry %s after error: %s", attempt + 1, exc)
            time.sleep(5 * (attempt + 1))


def interval_minutes(item: dict, settings: dict) -> int:
    """Per-post override, else the dashboard's platform setting, else the built-in default."""
    return num(item.get("interval_min")) or num(settings.get(f"interval_{item['platform']}")) or DEFAULT_INTERVAL.get(item["platform"], 60)


def is_due(last_iso, minutes: int) -> bool:
    if FORCE or not last_iso:
        return True
    try:
        age = datetime.now(timezone.utc) - datetime.fromisoformat(last_iso)
    except ValueError:
        return True
    return age >= timedelta(minutes=minutes * 0.85)  # tolerance for cron jitter


def spike_alerts(post: dict, prev: dict, cur: dict) -> list:
    out = []
    for metric in ("likes", "views", "comments"):
        a, b = num((prev or {}).get(metric)), cur.get(metric)
        if a is None or b is None:
            continue
        diff = b - a
        pct = (diff / a * 100) if a else 100.0
        if abs(diff) >= spike_min and abs(pct) >= spike_pct:
            kind = "spike" if diff > 0 else "drop"
            msg = f"{post['platform']} {kind}: {metric} {a:,} -> {b:,} ({pct:+.0f}%) {post['url']}"
            out.append({"created_at": now_iso(), "post_id": post["id"], "kind": kind, "message": msg})
            alerts.notify(msg)
    return out


def main() -> int:
    store = SheetsStore()
    store.ensure_tabs()
    # PLATFORMS lets two machines split the work (e.g. GitHub: youtube,twitter; your PC: instagram).
    allowed = {x.strip() for x in os.getenv("PLATFORMS", "instagram,twitter,youtube").split(",") if x.strip()}
    all_posts = [p for p in store.read("st_posts") if p.get("id") and truthy(p.get("active"))]
    posts = [p for p in all_posts if p["platform"] in allowed]
    skip_acc = {x.strip() for x in os.getenv("SKIP_ACCOUNTS", "").split(",") if x.strip()}  # e.g. X profiles are login-walled on GitHub's IPs
    accounts = [a for a in store.read("st_accounts") if a.get("id") and truthy(a.get("active")) and a["platform"] in allowed and a["platform"] not in skip_acc]
    prev_summary = {r["post_id"]: r for r in store.read("st_summary")}
    settings = {r["key"]: r["value"] for r in store.read("st_settings")}
    global spike_pct, spike_min
    spike_pct = float(settings.get("alert_spike_pct") or SPIKE_PCT)
    spike_min = float(settings.get("alert_spike_min") or SPIKE_MIN)
    last_acc: dict = {}
    for r in store.read("st_account_snapshots"):
        last_acc[r["account_id"]] = r["taken_at"]  # rows are chronological
    skipped = 0
    log.info("platforms=%s: tracking %d posts, %d accounts", ",".join(sorted(allowed)), len(posts), len(accounts))

    failures = 0
    ig_auth_failed = False
    ig_blocked = False
    new_snaps, new_alerts, new_acc_snaps = [], [], []
    post_changes: dict = {}
    acc_changes: dict = {}
    fresh: dict = {}  # post_id -> new data this run

    for post in posts:
        pid = post["id"]
        if not is_due((prev_summary.get(pid) or {}).get("last_taken_at"), interval_minutes(post, settings)):
            skipped += 1
            continue
        if post["platform"] == "instagram" and (ig_auth_failed or ig_blocked):
            if ig_blocked:
                post_changes[pid] = {"last_error": "Instagram is limiting this account - will retry next run"}
            else:
                post_changes[pid] = {"last_error": "Instagram Graph API token problem"}
            continue
        mod = MODULES.get(post["platform"])
        if not mod:
            continue
        try:
            data = with_retries(mod.fetch_post, post["external_id"], post)
            ts = now_iso()
            row = {k: data.get(k) for k in METRICS}
            row.update(post_id=pid, taken_at=ts)
            new_snaps.append(row)
            fresh[pid] = {**row}
            ch = {"last_error": ""}
            if not post.get("author") and data.get("author"):
                ch["author"] = data["author"]
            if not post.get("title") and data.get("title"):
                ch["title"] = data["title"]
            post_changes[pid] = ch
            new_alerts += spike_alerts(post, prev_summary.get(pid, {}), data)
            log.info("OK   %s %s %s", post["platform"], post["external_id"], {k: row[k] for k in METRICS})
        except instagram.RateLimited as exc:
            failures += 1
            ig_blocked = True
            log.error("%s", exc)
            post_changes[pid] = {"last_error": str(exc)[:300]}
            alerts.notify(f"Tracker: {exc}")
        except instagram.AuthError as exc:
            failures += 1
            ig_auth_failed = True
            log.error("Instagram Graph API problem: %s", exc)
            post_changes[pid] = {"last_error": str(exc)[:300]}
            alerts.notify(f"Tracker: {exc}")
        except Exception as exc:  # noqa: BLE001
            failures += 1
            log.error("FAIL %s %s: %s", post["platform"], post["external_id"], exc)
            post_changes[pid] = {"last_error": str(exc)[:300]}
        time.sleep(random.uniform(3, 6) if post["platform"] == "instagram" else random.uniform(0.5, 1.5))

    for acc in accounts:
        if not is_due(last_acc.get(acc["id"]), interval_minutes(acc, settings)):
            skipped += 1
            continue
        if acc["platform"] == "instagram" and (ig_auth_failed or ig_blocked):
            continue
        try:
            data = with_retries(MODULES[acc["platform"]].fetch_profile, acc["handle"])
            new_acc_snaps.append({**data, "account_id": acc["id"], "taken_at": now_iso()})
            acc_changes[acc["id"]] = {"last_error": ""}
            log.info("OK   account %s @%s %s", acc["platform"], acc["handle"], data)
        except Exception as exc:  # noqa: BLE001
            failures += 1
            log.error("FAIL account @%s: %s", acc["handle"], exc)
            acc_changes[acc["id"]] = {"last_error": str(exc)[:300]}
        time.sleep(random.uniform(1, 3))

    # ---- summary: latest numbers + recent history (for 24h deltas) -------------
    cutoff = datetime.now(timezone.utc) - timedelta(hours=HIST_HOURS)
    mine = {}
    for post in posts:
        pid = post["id"]
        if pid not in fresh:
            continue
        old = prev_summary.get(pid)
        f = fresh[pid]
        try:
            hist = json.loads(old["hist"]) if old and old.get("hist") else []
        except ValueError:
            hist = []
        hist = [h for h in hist if datetime.fromisoformat(h[0]) >= cutoff]
        hist.append([f["taken_at"], f["likes"], f["comments"], f["views"]])
        mine[pid] = {"post_id": pid, "last_taken_at": f["taken_at"], "likes": f["likes"],
                     "comments": f["comments"], "views": f["views"], "shares": f["shares"],
                     "hist": json.dumps(hist, separators=(",", ":"))}

    # ---- flush: a handful of batched API calls ---------------------------------
    store.append("st_snapshots", new_snaps)
    store.append("st_account_snapshots", new_acc_snaps)
    store.append("st_alerts", new_alerts)
    # Re-read right before writing so rows written meanwhile by another machine are kept.
    current = {r["post_id"]: r for r in store.read("st_summary")}
    current.update(mine)
    live_ids = {p["id"] for p in all_posts}
    store.replace_all("st_summary", [r for pid, r in current.items() if pid in live_ids])
    store.update_cells("st_posts", post_changes)
    store.update_cells("st_accounts", acc_changes)

    log.info("Done. snapshots=%d account_snapshots=%d alerts=%d failures=%d not-due-yet=%d",
             len(new_snaps), len(new_acc_snaps), len(new_alerts), failures, skipped)
    browser.close()
    return 0  # individual scrape errors are recorded in the sheet, not by failing the workflow


if __name__ == "__main__":
    sys.exit(main())
