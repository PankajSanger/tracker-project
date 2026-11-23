# Social Tracker - project map (read this first; open files only when needed)

Tracks likes/comments/views of Instagram, X and YouTube posts + account followers for a small team. 100% free, **scraping only**
(Selenium headless Chrome + BeautifulSoup). User rule: **no official APIs, no paid services**. Full user guide: `SETUP-WEB.md`.

## Graph
```
 [PC: Task Scheduler "SocialTrackerInstagram", every 5 min]    [cron-job.org, every 15 min] --POST dispatch--> [GitHub Actions scrape.yml]
   scraper\run_scrape.bat  (logs\scrape.log)                                                       IG_GRID=late, SOFT_ACCOUNTS=twitter,instagram
   CHROME_PROFILE_DIR=scraper\.chrome-profile (logged-in IG)                                       (server IPs: IG/X profile + reels grid often login-walled)
            \                                                                                       /
             '--> scraper/scrape.py --> youtube.py / twitter.py / instagram.py (via browser.py) --'
                         |  only posts that are DUE (interval) or have a check_now request
                         v
              Google Sheet "tracking" (sheets_store.py, service account)  tabs st_*
                         ^
                         |  server-side API routes (web/lib/server/sheets.ts, JWT service account)
              Next.js 14 app on Vercel  https://social-tracker-steel.vercel.app   (project "social-tracker", root dir web/)
```
Repo: github.com/PankajSanger/tracker-project (public, branch main). `gh` lives at `C:\Program Files\GitHub CLI\gh.exe` (not on PATH).

## Sheet tabs (schema = scraper/sheets_store.py TABS, mirrored in web/lib/server/sheets.ts)
- st_posts: id, platform, url, external_id, title, author, campaign, added_by, active, last_error, created_at, interval_min
- st_snapshots: post_id, taken_at, likes, comments, views, shares        (append-only history)
- st_summary: post_id, last_taken_at, likes, comments, views, shares, hist(JSON ~60h), views_at   (one row per post, fast reads)
- st_accounts / st_account_snapshots (followers, following, posts_count) / st_alerts
- st_settings key/value: interval_<platform>, alert_spike_pct/min, `check_now:<post_id>` = ISO time (scraper clears it)
- Old tabs `input`, `tracking_data` belong to the legacy script - never touch.

## scraper/ (Python, venv at ..\venv)
- scrape.py: main loop. Due logic = per-post interval_min > interval_<platform> setting > DEFAULT_INTERVAL (ig 180, others 60), tolerance 0.85.
  Order: check_now first, then stalest. MAX_IG_PER_RUN=8, 6-10s gap. `RateLimited` => stop IG for the run, no error mark.
  IG_GRID=late: after posts, try reels grids for views. Views missing => carry forward last views + views_at. Batched flush at end.
- instagram.py: logged-out post page -> exact likes/comments (embedded JSON cross-checked with og:description, `_pick_exact`).
  Views only from creator reels grid `/{user}/reels/` (play_count; ~12 logged out, ~37 logged in), `grid_lookup`, `_grid` cache.
  IG_GRID: "1" grid first (PC) | "0" off | "late" (GitHub). fetch_profile from og + follower_count.
- twitter.py: aria-label "N replies, N reposts, N likes". youtube.py: ytInitialPlayerResponse + likeCount + comments header.
- browser.py: shared driver, `wait_for`, `soup_of`, `network_json_bodies` (CDP perf log). sheets_store.py: read/append/update_cells/upsert_kv.
- selftest.py (7 live checks, SERVER_SKIP on CI), tests: `..\venv\Scripts\python.exe -m unittest test_instagram_parse test_scrape_logic` (16).
- ig_login.py: one-time manual IG login into .chrome-profile (`--check`). import_input.py: import legacy `input` tab. alerts.py: Telegram.
- Env: SPREADSHEET_ID, GOOGLE_SERVICE_ACCOUNT_FILE|_JSON, PLATFORMS, FORCE, MAX_IG_PER_RUN, IG_GRID, SKIP_ACCOUNTS, SOFT_ACCOUNTS,
  CHROME_PROFILE_DIR, SELENIUM_HEADLESS, TELEGRAM_*. Local values in scraper/.env.

## web/ (Next.js 14 app router, TypeScript)
- lib/server: sheets.ts (Sheets REST + upsertKV), store.ts (Sheets store + demo store when no SPREADSHEET_ID; requestCheck),
  auth.ts (HMAC cookie session, TEAM_USERS "email:pass,..."), analytics.ts (deltas, growth, engagement).
- lib: types.ts (PostRow, Settings, DEFAULT_SETTINGS), api.ts (client fetchers), hooks.ts, utils.ts (viewsStale, INTERVALS).
- Pages: / overview, /posts (table+cards, bulk bar: check now/pause/delete), /post?id= (detail, interval override, Check now, Delete),
  /compare, /accounts, /alerts, /settings. Components: Shell.tsx, ui.tsx, charts.tsx.
- API: posts, posts/[id] (PATCH incl. check_now, DELETE), accounts(/[id]), alerts, compare, overview, settings, login/logout/me.
- Vercel env: SPREADSHEET_ID, GOOGLE_SERVICE_ACCOUNT_B64, TEAM_USERS, SESSION_SECRET. Deploy: `cd web; npx vercel --prod`.
- Dev: `cd web; npm run dev` (demo mode without .env.local).

## Coverage / known limits
- PC on: everything. PC off (GitHub): YouTube + X posts fully, IG likes/comments; IG views + IG/X followers only when the runner's IP isn't walled (~1 in 3).
- Offered but NOT chosen: logged-in IG session as GitHub secret (account-lock risk; spare account only).
- GitHub's own cron (7,37) fires only every few hours -> cron-job.org dispatch is the real schedule. Dispatch respects intervals unless input force=true.

## Rules for Claude here
- Never type the user's passwords/tokens or print/commit secrets (key JSON `command-center-*.json`, .env, instagram_cookies.json, .chrome-profile).
- Commit/push only to main of the repo above; end commits with the Co-Authored-By line. Prefer Edit; Windows PowerShell 5.1 (no &&).
- Legacy (pre-website) files at root: instagram_tracker.py, config.py, debug_scrape.py, archive/ (old Supabase) - unused.
