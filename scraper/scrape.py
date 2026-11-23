"""One scrape pass over the Google Sheet.

Reads active posts/accounts from the sheet tabs (st_posts, st_accounts), fetches current
numbers from Instagram / X / YouTube, and writes snapshots + a per-post summary back.

Run by GitHub Actions on a cron; also runnable locally:
    python scrape.py            (secrets are read from scraper/.env or the environment)
"""
import json
import uuid
import logging
import os
import sys
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
import instagram  # noqa: E402
import twitter  # noqa: E402
import youtube  # noqa: E402
from apify_api import ApifyError  # noqa: E402
from sheets_store import SheetsStore, num, truthy  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("scrape")

SPIKE_PCT = float(os.getenv("ALERT_SPIKE_PCT", "25"))  # % change between runs
SPIKE_MIN = int(os.getenv("ALERT_SPIKE_MIN", "50"))    # ...and at least this many
spike_pct, spike_min = SPIKE_PCT, SPIKE_MIN            # overridden by the dashboard settings in main()
DEFAULT_INTERVAL = {"instagram": 180, "twitter": 60, "youtube": 60}  # minutes; changeable in the dashboard
FORCE = os.getenv("FORCE") == "1"                      # manual runs ignore the interval
HIST_HOURS = 60                                        # recent points kept per post for 24h deltas
# Followers are tracked per calendar period (dashboard setting account_period_days: 1=daily, 7=weekly, 30=monthly, 365=yearly),
# counted in this timezone (default India, UTC+5:30): the first run after midnight / Monday / the 1st / Jan 1 takes the snapshot.
TRACK_TZ = timezone(timedelta(minutes=int(os.getenv("TRACK_TZ_OFFSET_MIN", "330"))))
MODULES = {"instagram": instagram, "twitter": twitter, "youtube": youtube}
METRICS = ("likes", "comments", "views", "shares")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def interval_minutes(item: dict, settings: dict) -> int:
    """Per-post override, else the dashboard's platform setting, else the built-in default."""
    return num(item.get("interval_min")) or num(settings.get(f"interval_{item['platform']}")) or DEFAULT_INTERVAL.get(item["platform"], 60)


def period_key(when: datetime, days: int) -> str:
    d = when.astimezone(TRACK_TZ)
    if days >= 365:
        return f"{d.year}"
    if days >= 28:
        return f"{d.year}-{d.month:02d}"
    if days >= 7:
        y, w, _ = d.isocalendar()
        return f"{y}-W{w:02d}"
    return d.date().isoformat()


def account_due(last_iso, days: int, now: datetime = None) -> bool:
    """Due once per calendar day / week / month / year (not every N minutes)."""
    if FORCE or not last_iso:
        return True
    try:
        last = datetime.fromisoformat(last_iso)
    except ValueError:
        return True
    return period_key(now or datetime.now(timezone.utc), days) != period_key(last, days)


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


WATCH_DEFAULT_MIN = 180  # how often an auto-tracked account is checked for new posts, unless set per account


def _ts(iso: str):
    try:
        d = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def pick_new(candidates: list, since_iso: str, known: set, platform: str) -> list:
    """Candidates published at/after `since` that are not tracked yet (pinned old posts are skipped by date)."""
    since = _ts(since_iso) if since_iso else None
    out, seen = [], set()
    for c in candidates:
        key = (platform, c["external_id"])
        pub = _ts(c.get("published_at") or "")
        if key in known or key in seen or pub is None or (since and pub < since):
            continue
        seen.add(key)
        out.append(c)
    return sorted(out, key=lambda c: c["published_at"])


def run_watches(store, allowed: set, every_post: list) -> list:
    """Auto-track: look for new posts of watched accounts and add them to st_posts. Returns the new post rows."""
    watches = [w for w in store.read("st_watch") if w.get("id") and truthy(w.get("active")) and w.get("platform") in allowed]
    due = [w for w in watches if is_due(w.get("last_checked"), num(w.get("interval_min")) or WATCH_DEFAULT_MIN)]
    if not due:
        return []
    known = {(p["platform"], p["external_id"]) for p in every_post}
    new_rows, changes = [], {}
    by_platform: dict = {}
    for w in due:
        by_platform.setdefault(w["platform"], []).append(w)
    for platform, ws in by_platform.items():
        handles = list(dict.fromkeys(w["handle"] for w in ws))
        try:
            found = MODULES[platform].fetch_recent(handles)
        except ApifyError as exc:
            log.error("Apify auto-track %s: %s", platform, exc)
            found = {h: exc for h in handles}
        for w in ws:
            res = found.get(w["handle"])
            ch = {"last_checked": now_iso()}
            if isinstance(res, Exception) or res is None:
                ch["last_error"] = (f"Apify: {res}" if isinstance(res, ApifyError) else str(res or "nothing returned"))[:300]
                log.error("FAIL auto-track %s @%s: %s", platform, w["handle"], ch["last_error"])
            else:
                fresh = pick_new(res, w.get("since") or w.get("created_at") or "", known, platform)
                for c in fresh:
                    known.add((platform, c["external_id"]))
                    new_rows.append({
                        "id": str(uuid.uuid4()), "platform": platform, "url": c["url"], "external_id": c["external_id"],
                        "title": c.get("title") or "", "author": w["handle"].lstrip("@"), "campaign": w.get("campaign") or "",
                        "added_by": f"auto:@{w['handle'].lstrip('@')}", "active": "TRUE", "last_error": "", "created_at": now_iso(),
                        "interval_min": "", "thumbnail": c.get("thumbnail") or "",
                    })
                ch["last_error"] = ""
                if fresh:
                    ch["last_found"] = now_iso()
                    ch["posts_found"] = str((num(w.get("posts_found")) or 0) + len(fresh))
                log.info("OK   auto-track %s @%s: %d recent, %d new", platform, w["handle"], len(res), len(fresh))
            changes[w["id"]] = ch
    if new_rows:
        store.append("st_posts", new_rows)
        alerts.notify(f"Tracker: auto-track added {len(new_rows)} new post(s)")
    store.update_cells("st_watch", changes)
    return new_rows


def main() -> int:
    store = SheetsStore()
    store.ensure_tabs()
    # PLATFORMS limits a run to some platforms (default: all three).
    allowed = {x.strip() for x in os.getenv("PLATFORMS", "instagram,twitter,youtube").split(",") if x.strip()}
    every_post = [p for p in store.read("st_posts") if p.get("id")]
    new_posts = run_watches(store, allowed, every_post)  # auto-track: add accounts' new posts first, so they are fetched this run
    all_posts = [p for p in every_post + new_posts if truthy(p.get("active"))]
    posts = [p for p in all_posts if p["platform"] in allowed]
    accounts = [a for a in store.read("st_accounts") if a.get("id") and truthy(a.get("active")) and a["platform"] in allowed]
    prev_summary = {r["post_id"]: r for r in store.read("st_summary")}
    settings = {r["key"]: r["value"] for r in store.read("st_settings")}
    global spike_pct, spike_min
    spike_pct = float(settings.get("alert_spike_pct") or SPIKE_PCT)
    spike_min = float(settings.get("alert_spike_min") or SPIKE_MIN)
    last_acc: dict = {}
    for r in store.read("st_account_snapshots"):
        last_acc[r["account_id"]] = r["taken_at"]  # rows are chronological
    skipped = 0
    check_now_done: list = []
    log.info("platforms=%s: tracking %d posts, %d accounts", ",".join(sorted(allowed)), len(posts), len(accounts))

    failures = 0
    new_snaps, new_alerts, new_acc_snaps = [], [], []
    post_changes: dict = {}
    acc_changes: dict = {}
    fresh: dict = {}  # post_id -> new data this run

    # ---- pick the posts that are due ("Check now" requests always are) -------------
    due: dict = {}  # platform -> [post]
    for post in posts:
        pid = post["id"]
        last = (prev_summary.get(pid) or {}).get("last_taken_at")
        asked = settings.get(f"check_now:{pid}") or ""
        wanted_now = bool(asked) and (not last or asked > last)  # someone pressed "Check now" in the dashboard
        if wanted_now:
            check_now_done.append(f"check_now:{pid}")
        elif not is_due(last, interval_minutes(post, settings)):
            skipped += 1
            continue
        if "unavailable" in (post.get("last_error") or "") and not FORCE and not wanted_now and datetime.now().hour % 12 != 0:
            skipped += 1  # deleted/private post: re-checked only twice a day so it does not cost Apify credit every run
            continue
        if post["platform"] in MODULES:
            due.setdefault(post["platform"], []).append(post)

    # ---- one Apify run per platform for all its due posts ---------------------------
    for platform, plist in due.items():
        ids = list(dict.fromkeys(p["external_id"] for p in plist))
        try:
            results = MODULES[platform].fetch_posts(ids)
        except ApifyError as exc:
            log.error("Apify %s: %s", platform, exc)
            alerts.notify(f"Tracker: Apify {platform}: {exc}")
            results = {i: exc for i in ids}
        for post in plist:
            pid, data = post["id"], results.get(post["external_id"])
            if isinstance(data, Exception) or data is None:
                failures += 1
                msg = f"Apify: {data}" if isinstance(data, ApifyError) else str(data)
                log.error("FAIL %s %s: %s", platform, post["external_id"], msg)
                post_changes[pid] = {"last_error": msg[:300]}
                continue
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
            if data.get("thumbnail") and data["thumbnail"] != post.get("thumbnail"):
                ch["thumbnail"] = data["thumbnail"]  # always the latest link (Instagram's expire)
            post_changes[pid] = ch
            new_alerts += spike_alerts(post, prev_summary.get(pid, {}), data)
            log.info("OK   %s %s %s", platform, post["external_id"], {k: row[k] for k in METRICS})

    # ---- accounts (followers) ---------------------------------------------------------
    due_acc: dict = {}
    for acc in accounts:
        if account_due(last_acc.get(acc["id"]), num(settings.get("account_period_days")) or 1):
            due_acc.setdefault(acc["platform"], []).append(acc)
        else:
            skipped += 1
    for platform, alist in due_acc.items():
        handles = list(dict.fromkeys(a["handle"] for a in alist))
        try:
            results = MODULES[platform].fetch_profiles(handles)
        except ApifyError as exc:
            log.error("Apify %s accounts: %s", platform, exc)
            results = {h: exc for h in handles}
        for acc in alist:
            data = results.get(acc["handle"])
            if isinstance(data, Exception) or data is None:
                failures += 1
                msg = f"Apify: {data}" if isinstance(data, ApifyError) else str(data)
                log.error("FAIL account @%s: %s", acc["handle"], msg)
                acc_changes[acc["id"]] = {"last_error": msg[:300]}
                continue
            new_acc_snaps.append({**data, "account_id": acc["id"], "taken_at": now_iso()})
            acc_changes[acc["id"]] = {"last_error": ""}
            log.info("OK   account %s @%s %s", platform, acc["handle"], data)

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
        # no views this time (image post, or the actor left it out): keep the last known number (and when it was seen)
        views, views_at = f["views"], f["taken_at"] if f["views"] is not None else None
        if views is None and old and str(old.get("views", "")).strip() not in ("", "None"):
            views, views_at = num(old["views"]), old.get("views_at") or old.get("last_taken_at")
        hist.append([f["taken_at"], f["likes"], f["comments"], views])
        mine[pid] = {"post_id": pid, "last_taken_at": f["taken_at"], "likes": f["likes"],
                     "comments": f["comments"], "views": views, "shares": f["shares"],
                     "hist": json.dumps(hist, separators=(",", ":")), "views_at": views_at}

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
    store.upsert_kv("st_settings", {k: "" for k in check_now_done})  # clear the handled "Check now" requests

    log.info("Done. snapshots=%d account_snapshots=%d alerts=%d failures=%d not-due-yet=%d",
             len(new_snaps), len(new_acc_snaps), len(new_alerts), failures, skipped)
    return 0  # individual scrape errors are recorded in the sheet, not by failing the workflow


if __name__ == "__main__":
    sys.exit(main())
