"""Tiny Apify client: start an actor, wait for it, return its dataset items.

Token: APIFY_TOKEN (scraper/.env locally, a GitHub secret on Actions).
Optional APIFY_MAX_USD_PER_RUN caps what one actor run may charge (pay-per-event actors), default 0.50.

    python apify_api.py --check      checks the token and prints your Apify plan (costs nothing)
"""
import os
import sys
import time
from typing import Any, Dict, List

import requests

API = "https://api.apify.com/v2"
TERMINAL = {"SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"}


class ApifyError(Exception):
    """Apify itself failed (bad token, no credit, actor crashed). Not the post's fault."""


def _headers() -> Dict[str, str]:
    token = os.environ.get("APIFY_TOKEN", "").strip()
    if not token:
        raise ApifyError("APIFY_TOKEN is not set (scraper/.env or GitHub secret)")
    return {"Authorization": f"Bearer {token}"}


def _call(method: str, path: str, **kw: Any) -> Any:
    for attempt in range(3):
        try:
            r = requests.request(method, API + path, headers=_headers(), timeout=90, **kw)
        except requests.RequestException as exc:
            if attempt == 2:
                raise ApifyError(f"network error talking to Apify: {exc}") from exc
            time.sleep(5 * (attempt + 1))
            continue
        if r.status_code >= 500 and attempt < 2:
            time.sleep(5 * (attempt + 1))
            continue
        if r.status_code == 401:
            raise ApifyError("Apify rejected the token (APIFY_TOKEN wrong or revoked)")
        if r.status_code >= 400:
            msg = r.text[:300]
            try:
                msg = r.json().get("error", {}).get("message") or msg
            except ValueError:
                pass
            raise ApifyError(f"Apify {r.status_code}: {msg}")
        return r.json()
    raise ApifyError("Apify did not answer")


def run_actor(actor: str, payload: Dict[str, Any], timeout_s: int = 900) -> List[Dict[str, Any]]:
    """Runs e.g. 'apify/instagram-scraper' with `payload` and returns the items it produced."""
    params = {"waitForFinish": 60, "maxTotalChargeUsd": os.getenv("APIFY_MAX_USD_PER_RUN", "0.50")}
    run = _call("POST", f"/acts/{actor.replace('/', '~')}/runs", json=payload, params=params)["data"]
    deadline = time.time() + timeout_s
    while run["status"] not in TERMINAL:
        if time.time() > deadline:
            raise ApifyError(f"{actor} still running after {timeout_s}s (run {run['id']})")
        run = _call("GET", f"/actor-runs/{run['id']}", params={"waitForFinish": 60})["data"]
    if run["status"] != "SUCCEEDED":
        raise ApifyError(f"{actor} run {run['status'].lower()}: {run.get('statusMessage') or run['id']}")
    items = _call("GET", f"/datasets/{run['defaultDatasetId']}/items", params={"clean": "true", "format": "json"})
    return items if isinstance(items, list) else []


def check() -> str:
    me = _call("GET", "/users/me")["data"]
    return f"Apify token OK (user {me.get('username')}, plan {(me.get('plan') or {}).get('id')})"


if __name__ == "__main__":
    if "--check" in sys.argv:
        _envf = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
        if os.path.exists(_envf):
            for _l in open(_envf, encoding="utf-8").read().splitlines():
                if "=" in _l and not _l.lstrip().startswith("#"):
                    _k, _v = _l.split("=", 1)
                    os.environ.setdefault(_k.strip(), _v.strip())
        print(check())
