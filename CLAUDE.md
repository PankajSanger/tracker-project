# Social Tracker - project map (read this first; open files only when needed)

Tracks likes/comments/views of Instagram, X and YouTube posts + account followers for a small team. Data comes from **Apify actors**
(since 2026-11-23; Selenium/BeautifulSoup removed). User will pay for an Apify plan once everything works (free plan for now; X needs paid).
Still no official platform APIs. Full user guide: `SETUP-WEB.md`.

## Graph
```
 [cron-job.org, every 15 min] --POST dispatch--> [GitHub Actions scrape.yml]  (no PC task any more; run_scrape.bat = manual run)
                                                        |
        scraper/scrape.py --> instagram.py / youtube.py / twitter.py --> apify_api.run_actor (APIFY_TOKEN)
                         |  only posts that are DUE (interval) or have a check_now request; one Apify run per platform
                         v
              Google Sheet "tracking" (sheets_store.py, service account)  tabs st_*
                         ^
                         |  server-side API routes (web/lib/server/sheets.ts, JWT service account)
              Next.js 14 app on Vercel  https://social-tracker-steel.vercel.app   (project "social-tracker", root dir web/)
```
Repo: github.com/PankajSanger/tracker-project (public, branch main). `gh` lives at `C:\Program Files\GitHub CLI\gh.exe` (not on PATH).
GitHub secrets: SPREADSHEET_ID, GOOGLE_SERVICE_ACCOUNT_JSON, APIFY_TOKEN (+ optional TELEGRAM_*).

## Sheet tabs (schema = scraper/sheets_store.py TABS, mirrored in web/lib/server/sheets.ts)
- st_posts: id, platform, url, external_id, title, author, campaign, added_by, active, last_error, created_at, interval_min, thumbnail
  (thumbnail refreshed by every scrape - Instagram CDN links expire; web falls back to i.ytimg.com for YouTube and to the platform icon)
- st_snapshots: post_id, taken_at, likes, comments, views, shares        (append-only history)
- st_summary: post_id, last_taken_at, likes, comments, views, shares, hist(JSON ~60h), views_at   (one row per post, fast reads)
- st_accounts / st_account_snapshots (followers, following, posts_count) / st_alerts
- st_settings key/value: interval_<platform>, alert_spike_pct/min, `check_now:<post_id>` = ISO time (scraper clears it),
  account_period_days (1/7/30/365 = followers once per calendar day/ISO week/month/year, IST via TRACK_TZ_OFFSET_MIN=330; default 1),
  `share:<token>` = JSON {c: campaign|null, by, at} client report links (value "" = revoked)
- Old tabs `input`, `tracking_data` belong to the legacy script - never touch.

## scraper/ (Python, venv at ..\venv; deps: requests, google-auth only)
- scrape.py: due logic = per-post interval_min > interval_<platform> setting > DEFAULT_INTERVAL (ig 180, others 60), tolerance 0.85.
  Groups due posts by platform -> `mod.fetch_posts(ids)` -> {id: data | Exception}; same for accounts `fetch_profiles(handles)`
  (accounts use `account_due` = calendar period from account_period_days, not minutes).
  `ApifyError` (token/credit/actor failure) => last_error "Apify: ..." + Telegram alert. "unavailable" errors re-checked only 2x/day.
  Views missing => carry forward last views + views_at. Batched Sheet flush at end (sheets_store retries stale connections).
- apify_api.py: run_actor(actor, input) = start run, poll, read dataset; APIFY_MAX_USD_PER_RUN cap (0.50). `--check` tests token.
- instagram.py: apify/instagram-scraper (directUrls /p/{code}/; likesCount, commentsCount, videoPlayCount=views), apify/instagram-profile-scraper.
- youtube.py: streamers/youtube-scraper (viewCount, likes, commentsCount; channel subs via @handle/videos, one run per channel).
- twitter.py: kaitoeasyapi/twitter-x-data-tweet-scraper-pay-per-result-cheapest (tweetIDs; likeCount/replyCount/retweetCount/viewCount).
  FREE Apify plan returns `mock_tweet` items for every X actor tested (also apidojo/tweet-scraper) -> raised as ApifyError.
- Tests: `..\venv\Scripts\python.exe -m unittest test_apify_parse test_scrape_logic` (16). import_input.py: import legacy `input` tab. alerts.py: Telegram.
- Env: SPREADSHEET_ID, GOOGLE_SERVICE_ACCOUNT_FILE|_JSON, APIFY_TOKEN, APIFY_MAX_USD_PER_RUN, PLATFORMS, FORCE, TELEGRAM_*. Local values in scraper/.env.

## web/ (Next.js 14 app router, TypeScript)
- lib/server: sheets.ts (Sheets REST + upsertKV), store.ts (Sheets store + demo store when no SPREADSHEET_ID; requestCheck),
  auth.ts (HMAC cookie session, TEAM_USERS "email:pass,..."), analytics.ts (deltas, growth, engagement).
- lib: types.ts (PostRow, Settings, DEFAULT_SETTINGS), api.ts (client fetchers), hooks.ts, utils.ts (viewsStale, INTERVALS).
- Pages: / overview, /posts (table+cards, bulk bar: check now/pause/delete), /post?id= (detail, interval override, Check now, Delete),
  /compare, /accounts, /reports (campaign reports + client links), /alerts, /settings.
  /report?c=Campaign (team) or /report?t=token (client, no login; Shell renders it bare) - "Download PDF" = window.print + @media print A4 CSS.
  Components: Shell.tsx, ui.tsx (Thumb, Cover, Kpi...), charts.tsx. Theme: "enterprise navy" tokens in globals.css (--nav-*, --accent #1f5fd6).
- API: posts, posts/[id] (PATCH incl. check_now, DELETE), accounts(/[id]), alerts, compare, overview, settings, login/logout/me,
  shares (GET/POST/DELETE, team), report (?t= public read-only: campaign comes from the token only; else needs login). buildReport in analytics.ts.
- Vercel env: SPREADSHEET_ID, GOOGLE_SERVICE_ACCOUNT_B64, TEAM_USERS, SESSION_SECRET. Deploy: `cd web; npx vercel --prod`.
- Dev: `cd web; npm run dev` (demo mode without .env.local).

## Coverage / known limits
- Everything runs on GitHub + Apify: IG likes/comments/views + followers, YouTube, X (X only on a paid Apify plan).
- Cost scales with posts x checks; Apify free credit ~$5/month. Interval settings are the cost knob.
- GitHub's own cron (7,37) fires only every few hours -> cron-job.org dispatch is the real schedule. Dispatch respects intervals unless input force=true.

## Rules for Claude here
- Never type the user's passwords/tokens or print/commit secrets (key JSON `command-center-*.json`, .env incl. APIFY_TOKEN, instagram_cookies.json).
- Commit/push only to main of the repo above; end commits with the Co-Authored-By line. Prefer Edit; Windows PowerShell 5.1 (no &&).
- Legacy (pre-website) files at root: instagram_tracker.py, config.py, debug_scrape.py, archive/ (old Supabase) - unused.
