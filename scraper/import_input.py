"""One-time import of the old tracker's `input` tab into the new `st_posts` tab.

The old tab (post_url, creator_name, content_type, active) is only READ; nothing in it or in
`tracking_data` is modified. Posts already present in st_posts are skipped, so it is safe to re-run.

    python import_input.py            # preview what would be imported
    python import_input.py --apply    # actually add them
"""
import os
import sys
import uuid
from datetime import datetime, timezone

_envf = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
if os.path.exists(_envf):
    for _l in open(_envf, encoding="utf-8").read().splitlines():
        if "=" in _l and not _l.lstrip().startswith("#"):
            _k, _v = _l.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip())

import instagram  # noqa: E402
import twitter  # noqa: E402
import youtube  # noqa: E402
from sheets_store import SheetsStore, truthy  # noqa: E402


def main() -> None:
    s = SheetsStore()
    s.ensure_tabs()
    try:
        old = s._req("GET", f"https://sheets.googleapis.com/v4/spreadsheets/{s.sid}/values/input!A1:D").get("values", [])
    except RuntimeError:
        sys.exit("This spreadsheet has no `input` tab - nothing to import.")
    header = [h.strip().lower() for h in old[0]] if old else []
    if "post_url" not in header:
        sys.exit("No `input` tab with a post_url column found in this spreadsheet.")
    col = {h: i for i, h in enumerate(header)}
    have = {(p["platform"], p["external_id"]) for p in s.read("st_posts")}
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    rows, skipped, bad = [], 0, 0
    for r in old[1:]:
        r = list(r) + [""] * 4
        url = r[col["post_url"]].strip()
        if not url:
            continue
        platform, ext = None, None
        if (sc := instagram.parse_url(url)):
            platform, ext = "instagram", sc
        elif (t := twitter.parse_url(url)):
            platform, ext = "twitter", t[1]
        elif (v := youtube.parse_url(url)):
            platform, ext = "youtube", v
        if not platform:
            bad += 1
            continue
        if (platform, ext) in have:
            skipped += 1
            continue
        have.add((platform, ext))
        active = r[col["active"]] if "active" in col else "TRUE"
        rows.append({
            "id": str(uuid.uuid4()), "platform": platform, "url": url.split("?")[0], "external_id": ext,
            "author": r[col["creator_name"]].strip() if "creator_name" in col else "",
            "campaign": "imported", "added_by": "import", "active": "TRUE" if (not active or truthy(active)) else "FALSE",
            "created_at": now,
        })
    print(f"{len(rows)} new posts to import, {skipped} already present, {bad} unrecognised URLs")
    for r in rows[:10]:
        print("  ", r["platform"], r["external_id"], r["author"])
    if "--apply" in sys.argv:
        s.append("st_posts", rows)
        print("Imported.")
    else:
        print("Preview only. Re-run with --apply to import.")


if __name__ == "__main__":
    main()
