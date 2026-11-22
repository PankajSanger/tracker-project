# Social Tracker - Instagram, X and YouTube (Google Sheets + Vercel, free)

```
GitHub Actions + your PC  --scrapes-->  Google Sheet (st_* tabs)  <--API routes--  Next.js site on Vercel
   scraper/scrape.py                    your spreadsheet                          web/   (team logins)
```
- **Data** lives in a Google Sheet you own. You can open it, filter it, chart it, export it.
- **Website** (Vercel) reads/writes the sheet through server-side API routes using a service account. The key never reaches the browser.
- **Scraper** (Python) runs on GitHub Actions every 30 minutes (X, and YouTube once a `YT_API_KEY` secret exists) and on a PC every hour (Instagram, YouTube), because Vercel's free plan can't run long jobs or a browser.

## 1. The spreadsheet
Use your existing `tracking` spreadsheet or a new one. The app only creates and touches its own tabs, named `st_posts`, `st_snapshots`,
`st_summary`, `st_accounts`, `st_account_snapshots`, `st_alerts`. Your old `input` and `tracking_data` tabs are never modified.
1. Copy the spreadsheet ID from its URL: `docs.google.com/spreadsheets/d/<THIS PART>/edit`.
2. Share it (Editor) with your service account's email (`client_email` inside the key JSON, e.g. `...@...iam.gserviceaccount.com`). The Google Sheets API must be enabled for that Google Cloud project (it already is if your old tracker worked).
3. Optional - bring over your old tracked posts: `cd scraper`, then `..\venv\Scripts\python.exe import_input.py` (preview) and `... import_input.py --apply`.

Capacity: a Google Sheet holds 10 million cells. One snapshot = 6 cells, so 100 posts tracked hourly use ~14,000 cells/day (about 2 years of room, shared with anything else in the file).

## 2. GitHub (runs the scraper every 30 minutes - free)
1. Push this folder to a GitHub repo (`.gitignore` already keeps keys, cookies and `.env` files out).
2. Settings -> Secrets and variables -> Actions -> **Secrets**:
   - `SPREADSHEET_ID`
   - `GOOGLE_SERVICE_ACCOUNT_JSON` - paste the whole key file contents
   - **Not** the Instagram values: Instagram deliberately does not run on GitHub (see section 2b).
   - optional: `YT_API_KEY` (free YouTube Data API v3 key: adds comment counts), `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` (phone alerts)
3. Actions tab -> **scrape** -> Run workflow. Check the sheet: `st_snapshots` should fill. It then runs every hour.

## 2b. Instagram runs on your PC (Windows Task Scheduler)
Instagram logs a session out or limits the account when it is suddenly used from a datacenter address, so GitHub only scrapes YouTube and X
(`PLATFORMS=youtube,twitter` in the workflow) and Instagram runs from a PC:
1. `cd scraper`, then `..\venv\Scripts\python.exe ig_login.py` - log in once in the Chrome window. It saves the session to `scraper\.env` (git-ignored) next to `SPREADSHEET_ID` and `GOOGLE_SERVICE_ACCOUNT_FILE`.
2. Task `SocialTrackerInstagram` (created on the setup PC) runs `scraper\run_scrape.bat` every hour while you are logged in to Windows (it only fetches posts that are due); missed runs start when the PC is back. Log: `scraper\logs\scrape.log`. You can also double-click `run_scrape.bat` for a refresh, but do not run it repeatedly.
3. If Instagram answers "Try Again Later" (`feedback_required`), the run stops immediately, marks the posts "Instagram is limiting this account", and tries again next time. Raising the frequency or running it by hand repeatedly prolongs the block. Fewer posts and longer intervals are safer for the account.

## 3. Vercel (the website - free "Hobby" plan)
1. vercel.com -> Add New -> Project -> import the GitHub repo. Set **Root Directory = `web`** (Next.js is detected).
2. Settings -> Environment Variables (Production):

   | Name | Value |
   |---|---|
   | `SPREADSHEET_ID` | the sheet id |
   | `GOOGLE_SERVICE_ACCOUNT_B64` | base64 of the key file. PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("key.json"))` |
   | `TEAM_USERS` | `asha@yourco.com:pass1,ravi@yourco.com:pass2` |
   | `SESSION_SECRET` | any long random string |

3. Deploy. Open the URL and sign in with one of the `TEAM_USERS` pairs.

Note: Vercel's free Hobby plan is for **non-commercial** use. If this is for a company, use a paid plan or another host (the same `web/` app also runs on Netlify, Render or Cloudflare with the same variables).
Without `SPREADSHEET_ID` the site runs in **demo mode** on sample data (any login works) - never deploy it that way.

## 4. Your team
- Everyone shares one workspace; each post shows who added it ("Added by" column + filter).
- Add/remove people or change a password: edit `TEAM_USERS` in Vercel, then Redeploy. Passwords are stored only there.
- A teammate adds posts by pasting URLs; the first numbers appear after the next hourly run (or run **scrape** from the Actions tab for instant data).

## Tracking intervals (dashboard -> Settings)
Choose how often each platform is checked (15 minutes to 7 days), and override it per post on the post's page. The runners wake up every 30 minutes
(GitHub) / hourly (PC) and each post is only fetched when it is **due**, so the real minimum is the runner cadence. Instagram defaults to 6 hours; going below
3 hours risks the account being limited. Run **scrape** from the Actions tab for an immediate refresh of everything (manual runs ignore the intervals).
Alert thresholds (spike/drop %) are also set there. The two machines coordinate through the sheet: whichever sees a post as due fetches it.

## Features
- Overview with KPI cards + sparklines, growth chart (24h/7d/30d/all), platform split, fastest growing / top performing / needs attention
- Post detail: custom date range, hourly/daily/each-check granularity, total vs growth view, engagement rate
- Compare up to 6 posts (indexed growth or absolute); bulk pause/resume/campaign; search and filters; table or card view; light/dark theme
- Instagram / X / YouTube posts; bulk-paste URLs (watch, youtu.be, shorts links all work), campaign tags, pause/delete
- Dashboard totals, 24h change, sort/filter by platform, campaign, teammate; CSV export
- Per-post growth chart (1d / 7d / 30d / all) with snapshot-by-snapshot deltas
- Account tracking (followers / subscribers over time)
- Spike/drop alerts (default 25% and at least 50 change; tune with `ALERT_SPIKE_PCT`, `ALERT_SPIKE_MIN`) + optional Telegram push

## Local run
Website: `cd web`, copy `.env.local.example` to `.env.local` (fill in), `npm install`, `npm run dev` -> http://localhost:3000.
Scraper: `cd scraper`, put `SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_FILE=..\key.json` and the `IG_*` values in `scraper/.env`, then `..\venv\Scripts\python.exe scrape.py`.
(`archive/supabase/` holds the earlier Supabase version of the database; it is not used.)

## Know the limits
- **Instagram** needs a logged-in session cookie that lives only on the PC (never on GitHub). It can expire or get rate-limited: the dashboard shows the error; re-run `ig_login.py`. Automated access breaks Instagram's terms and can get the account restricted - one first burst of 27 requests already got the account temporarily limited - so use a throwaway account and keep the interval at 6 hours or more.
- **Instagram follower counts**: the profile API is rate-limited hard (HTTP 429). Set `IG_BROWSER_FALLBACK=1` in `scraper/.env` and run on your PC: it reads the profile page in a real logged-in Chrome (counts abbreviated by Instagram, e.g. 966K). Can't run on GitHub Actions.
- **YouTube**: no login. Keyless mode gives views + likes (no comments) and rounded subscribers; `YT_API_KEY` adds comments.
- **X/Twitter**: no login. Likes/replies from X's public embed endpoint; retweets and followers from the free FixTweet API (third party, may change). Views are usually unavailable.
- **Sheets quotas**: ~60 writes/min. The scraper batches everything into a few calls per run, so hundreds of posts are fine.
- GitHub cron can drift by minutes, and a repo with no commits for 60 days gets its scheduled workflows paused.
