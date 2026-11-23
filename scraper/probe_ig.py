"""Temporary probe: which Instagram sources for views/followers work from this machine's IP. Writes nothing."""
import time

import browser
import instagram
import twitter


def run(name, fn):
    t = time.time()
    try:
        print(f"{name:34} -> {fn()}  ({time.time() - t:.0f}s)", flush=True)
    except Exception as exc:  # noqa: BLE001
        print(f"{name:34} -> ERROR {type(exc).__name__}: {str(exc)[:150]}  ({time.time() - t:.0f}s)", flush=True)


def grid(user):
    instagram.grid_lookup(user, "__none__")
    items = instagram._grid[user]["items"]
    v = {k: x["views"] for k, x in items.items() if x.get("views")}
    return f"{len(v)} reels with views, e.g. {dict(list(v.items())[:2])}"


run("D reels grid (natgeo) FIRST", lambda: grid("natgeo"))
time.sleep(8)
run("C profile page (natgeo)", lambda: instagram.fetch_profile("natgeo"))
time.sleep(8)
run("D reels grid (instagram)", lambda: grid("instagram"))
time.sleep(8)
run("C profile page (instagram)", lambda: instagram.fetch_profile("instagram"))
run("X profile (NASA)", lambda: twitter.fetch_profile("NASA"))
browser.close()
