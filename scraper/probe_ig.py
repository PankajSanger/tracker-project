"""Temporary probe: which Instagram sources for views/followers work from this machine's IP. Writes nothing."""
import json
import time

import requests

import browser
import instagram

USERS = ["instagram", "natgeo"]
APP_ID = "936619743392459"   # the public id instagram.com's own web app sends
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"


def summarize(data):
    u = (data.get("data") or {}).get("user") or {}
    edges = ((u.get("edge_owner_to_timeline_media") or {}).get("edges")) or []
    views = [e["node"].get("video_view_count") for e in edges if e["node"].get("is_video")]
    return {"followers": (u.get("edge_followed_by") or {}).get("count"), "posts": len(edges), "video_views": views[:4]}


def probe_requests(user):
    r = requests.get(f"https://www.instagram.com/api/v1/users/web_profile_info/?username={user}",
                     headers={"x-ig-app-id": APP_ID, "User-Agent": UA, "Accept": "*/*"}, timeout=20)
    return r.status_code, (summarize(r.json()) if r.ok else r.text[:120])


def probe_browser_fetch(user):
    d = browser.get_driver()
    js = """const cb = arguments[arguments.length-1];
    fetch('/api/v1/users/web_profile_info/?username=' + arguments[0], {headers: {'x-ig-app-id': arguments[1]}, credentials: 'include'})
      .then(r => r.text().then(t => cb([r.status, t]))).catch(e => cb([0, String(e)]));"""
    d.set_script_timeout(25)
    status, text = d.execute_async_script(js, user, APP_ID)
    try:
        return status, summarize(json.loads(text))
    except ValueError:
        return status, text[:120]


def run(name, fn):
    t = time.time()
    try:
        print(f"{name:34} -> {fn()}  ({time.time() - t:.0f}s)", flush=True)
    except Exception as exc:  # noqa: BLE001
        print(f"{name:34} -> ERROR {type(exc).__name__}: {str(exc)[:150]}  ({time.time() - t:.0f}s)", flush=True)


for u in USERS:
    run(f"A requests api ({u})", lambda: probe_requests(u))
browser.get_driver().get("https://www.instagram.com/p/DbVW05gk_1i/")   # a page that loads logged out, so fetch() runs on instagram.com
time.sleep(4)
print("   current url:", browser.get_driver().current_url)
for u in USERS:
    run(f"B in-page fetch api ({u})", lambda: probe_browser_fetch(u))
    time.sleep(3)
run("C profile page (instagram)", lambda: instagram.fetch_profile("instagram"))
run("D reels grid (instagram)", lambda: len(instagram.grid_lookup("instagram", "__none__") or {}) or
    {k: v for k, v in list(instagram._grid["instagram"]["items"].items())[:3]})
browser.close()
