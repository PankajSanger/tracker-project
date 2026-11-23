"""Google Sheets as the database (Sheets API v4 over plain HTTPS).

Auth: a Google service account that has been shared (Editor) on the spreadsheet.
  GOOGLE_SERVICE_ACCOUNT_JSON  - the full key JSON as a string (GitHub secret), or
  GOOGLE_SERVICE_ACCOUNT_FILE  - path to the key file (local runs)
  SPREADSHEET_ID               - id from the sheet URL (docs.google.com/spreadsheets/d/<ID>/edit)

Writes are buffered by the caller and flushed in a few batched calls, because the
Sheets API only allows ~60 write requests per minute.
"""
import json
import os
import time
from typing import Any, Dict, List, Optional

import requests
from google.auth.transport.requests import AuthorizedSession
from google.oauth2 import service_account

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
API = "https://sheets.googleapis.com/v4/spreadsheets"

TABS: Dict[str, List[str]] = {
    "st_posts": ["id", "platform", "url", "external_id", "title", "author", "campaign", "added_by", "active", "last_error", "created_at", "interval_min", "thumbnail"],
    "st_snapshots": ["post_id", "taken_at", "likes", "comments", "views", "shares"],
    "st_summary": ["post_id", "last_taken_at", "likes", "comments", "views", "shares", "hist", "views_at"],
    "st_accounts": ["id", "platform", "handle", "active", "last_error", "created_at"],
    "st_account_snapshots": ["account_id", "taken_at", "followers", "following", "posts_count"],
    "st_alerts": ["created_at", "post_id", "kind", "message"],
    "st_settings": ["key", "value"],
    # auto-track: accounts whose new posts are added to st_posts automatically
    "st_watch": ["id", "platform", "handle", "campaign", "active", "interval_min", "since", "last_checked", "last_found",
                 "posts_found", "last_error", "created_at", "added_by"],
}


def col_letter(n: int) -> str:  # 1 -> A
    s = ""
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def truthy(v: Any) -> bool:
    return str(v).strip().lower() in ("true", "1", "yes", "y")


def num(v: Any) -> Optional[int]:
    if v in (None, ""):
        return None
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


class SheetsStore:
    def __init__(self) -> None:
        raw = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
        if raw:
            info = json.loads(raw)
            creds = service_account.Credentials.from_service_account_info(info, scopes=SCOPES)
        else:
            path = os.environ["GOOGLE_SERVICE_ACCOUNT_FILE"]
            creds = service_account.Credentials.from_service_account_file(path, scopes=SCOPES)
        self.sid = os.environ["SPREADSHEET_ID"]
        self.http = AuthorizedSession(creds)

    # ---- low level -------------------------------------------------------
    def _req(self, method: str, url: str, **kw: Any) -> Dict[str, Any]:
        for attempt in range(3):
            try:
                r = self.http.request(method, url, timeout=60, **kw)
                break
            except requests.ConnectionError:
                # the kept-alive connection goes stale while we wait minutes for Apify: reconnect and retry
                if attempt == 2:
                    raise
                self.http.close()
                time.sleep(2 * (attempt + 1))
        if r.status_code >= 400:
            raise RuntimeError(f"Sheets API {r.status_code}: {r.text[:300]}")
        return r.json() if r.text else {}

    def ensure_tabs(self) -> None:
        meta = self._req("GET", f"{API}/{self.sid}?fields=sheets.properties.title")
        have = {s["properties"]["title"] for s in meta.get("sheets", [])}
        missing = [t for t in TABS if t not in have]
        if missing:
            self._req("POST", f"{API}/{self.sid}:batchUpdate",
                      json={"requests": [{"addSheet": {"properties": {"title": t}}} for t in missing]})
        for t in TABS:
            head = self._req("GET", f"{API}/{self.sid}/values/{t}!A1:Z1").get("values") or [[]]
            have = [h for h in head[0] if h != ""]
            # empty tab -> write headers; older tab with fewer columns -> extend (never reorders existing ones)
            if len(have) < len(TABS[t]) and have == TABS[t][:len(have)]:
                self._req("PUT", f"{API}/{self.sid}/values/{t}!A1?valueInputOption=RAW",
                          json={"values": [TABS[t]]})

    def read(self, tab: str) -> List[Dict[str, Any]]:
        header = TABS[tab]
        rng = f"{tab}!A2:{col_letter(len(header))}"
        vals = self._req("GET", f"{API}/{self.sid}/values/{rng}?majorDimension=ROWS").get("values", [])
        return [dict(zip(header, list(r) + [""] * (len(header) - len(r)))) for r in vals]

    def append(self, tab: str, rows: List[Dict[str, Any]]) -> None:
        if not rows:
            return
        header = TABS[tab]
        values = [[("" if r.get(h) is None else r.get(h)) for h in header] for r in rows]
        for i in range(0, len(values), 2000):
            self._req("POST",
                      f"{API}/{self.sid}/values/{tab}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
                      json={"values": values[i:i + 2000]})

    def update_cells(self, tab: str, changes: Dict[str, Dict[str, Any]]) -> None:
        """changes = {row_id: {column_name: value}}; rows are located by their id (column A) at call time."""
        if not changes:
            return
        header = TABS[tab]
        ids = self._req("GET", f"{API}/{self.sid}/values/{tab}!A2:A").get("values", [])
        row_of = {r[0]: i + 2 for i, r in enumerate(ids) if r}
        data = []
        for rid, cols in changes.items():
            row = row_of.get(rid)
            if not row:
                continue  # deleted meanwhile
            for name, val in cols.items():
                c = col_letter(header.index(name) + 1)
                data.append({"range": f"{tab}!{c}{row}", "values": [["" if val is None else val]]})
        if data:
            self._req("POST", f"{API}/{self.sid}/values:batchUpdate",
                      json={"valueInputOption": "RAW", "data": data})

    def replace_all(self, tab: str, rows: List[Dict[str, Any]]) -> None:
        header = TABS[tab]
        end = col_letter(len(header))
        self._req("POST", f"{API}/{self.sid}/values/{tab}!A2:{end}:clear", json={})
        if rows:
            values = [[("" if r.get(h) is None else r.get(h)) for h in header] for r in rows]
            self._req("PUT", f"{API}/{self.sid}/values/{tab}!A2?valueInputOption=RAW", json={"values": values})

    def upsert_kv(self, tab: str, kv: Dict[str, Any]) -> None:
        """Set key/value rows (column A = key, B = value), updating existing keys in place."""
        if not kv:
            return
        rows = self._req("GET", f"{API}/{self.sid}/values/{tab}!A2:B").get("values", [])
        row_of = {r[0]: i + 2 for i, r in enumerate(rows) if r}
        data, fresh = [], []
        for k, v in kv.items():
            if k in row_of:
                data.append({"range": f"{tab}!B{row_of[k]}", "values": [["" if v is None else v]]})
            else:
                fresh.append({"key": k, "value": "" if v is None else v})
        if data:
            self._req("POST", f"{API}/{self.sid}/values:batchUpdate", json={"valueInputOption": "RAW", "data": data})
        self.append(tab, fresh)
