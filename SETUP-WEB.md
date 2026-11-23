# Social Tracker - Instagram, X and YouTube (Google Sheets + Vercel, free)

```
GitHub Actions (+ your PC)  --scrapes-->  Google Sheet (st_* tabs)  <--API routes--  Next.js site on Vercel
   scraper/scrape.py                      your spreadsheet                            web/   (team logins)
```
- **Data** lives in a Google Sheet you own. You can open it, filter it, chart it, export it.
- **Website** (Vercel) reads/writes the sheet through server-side API routes using a service account. The key never reaches the browser.
- **Collecting the numbers** (Python, `scraper/`):
  - **Everything is scraped with Selenium (headless Chrome) + Beautiful Soup.** No official APIs, no API keys, no logins, no accounts at risk, all free.
  - **PC** (Windows Task Scheduler runs `scraper\run_scrape.bat` every 5 minutes): everything, including Instagram views and follower counts.
  - **GitHub Actions**, started every 15 minutes by cron-job.org (GitHub's own schedule only fires every few hours): runs when the PC is off. Covers YouTube, X and Instagram likes/comments, but not Instagram views or X/Instagram follower counts.

## 1. The spreadsheet
Use your existing `tracking` spreadsheet or a new one. The app only creates and touches its own tabs, named `st_posts`, `st_snapshots`,
`st_summary`, `st_accounts`, `st_account_snapshots`, `st_alerts`, `st_settings`. Your old `input` and `tracking_data` tabs are never modified.
1. Copy the spreadsheet ID from its URL: `docs.google.com/spreadsheets/d/<THIS PART>/edit`.
2. Share it (Editor) with your service account's email (`client_email` inside the key JSON). The Google Sheets API must be enabled for that Google Cloud project.
3. Optional - bring over your old tracked posts: `cd scraper`, then `..\venv\Scripts\python.exe import_input.py` (preview) and `... import_input.py --apply`.

Capacity: a Google Sheet holds 10 million cells. One snapshot = 6 cells, so 100 posts tracked hourly use ~14,000 cells/day (about 2 years of room).

## 2. What is collected, and from where
| | Post numbers | Account numbers |
|---|---|---|
| **YouTube** | views, likes, comments, title, channel | subscribers, video count |
| **X** | likes, replies, reposts (views on newer posts) | followers, following, posts (rounded by X, e.g. 92.1M) |
| **Instagram** | exact likes, comments, creator, caption; exact views for reels among the creator's recent reels | exact followers, following, posts |

Instagram shows **views** only in a creator's reels grid, and only for their recent reels: about 12 for a logged-out visitor, about 37 after logging in the scraper's own Chrome profile once (`cd scraper`, `..\venv\Scripts\python.exe ig_login.py`; use a secondary account). For older reels the dashboard keeps the last views it saw and marks them "last seen ..." (`*` in the table). Image posts have no views, and **shares** are never shown on the web.
Offline tests of the parsers: `cd scraper`, `..\venv\Scripts\python.exe -m unittest test_instagram_parse test_scrape_logic`.

## 3. GitHub (runs the scraper every 30 minutes - free)
1. Push this folder to a GitHub repo (`.gitignore` keeps keys and `.env` files out).
2. Settings -> Secrets and variables -> Actions -> **Secrets**:
   - `SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON` (whole key file contents)
   - optional: `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` (phone alerts)
3. Actions tab -> **selftest** -> Run workflow: tries a known YouTube, X and Instagram post/profile with Selenium from GitHub's servers (writes nothing) and prints OK/FAIL for each.
4. Actions tab -> **scrape** -> Run workflow (tick "force" to fetch every post now, ignoring the intervals).
5. **Reliable schedule (free):** GitHub's own cron fires only every few hours, so let cron-job.org start the workflow every 15 minutes:
   - GitHub -> Settings -> Developer settings -> Fine-grained tokens -> Generate. Repository access: only `tracker-project`. Permissions: **Actions: Read and write**. Expiry: 1 year.
   - cron-job.org -> Create cronjob. URL `https://api.github.com/repos/PankajSanger/tracker-project/actions/workflows/scrape.yml/dispatches`, every 15 minutes.
     Advanced: method **POST**; headers `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`; body `{"ref":"main"}`. "Test run" should return **204**.
   - These runs respect the intervals, so only posts that are due get fetched.

## 4. Vercel (the website - free "Hobby" plan)
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

## 5. Your team
- Everyone shares one workspace; each post shows who added it ("Added by" column + filter).
- Add/remove people or change a password: edit `TEAM_USERS` in Vercel, then Redeploy. Passwords are stored only there.
- A teammate adds posts by pasting URLs; the first numbers appear after the next run (or run **scrape** from the Actions tab for instant data).

## Tracking intervals (dashboard -> Settings)
Choose how often each platform is checked (15 minutes to 7 days) and override it per post on the post's page. The PC checks every 5 minutes for posts that are
**due**, so a 15-minute interval really is ~15 minutes (while the PC is on). **Check now** (post page, table row, or bulk) refreshes a post on the next run, within ~5 minutes.
**Delete** is on the post page header, on every table row, and in the bulk bar (history stays in the sheet). Defaults: 1 hour for YouTube and X, 3 hours for Instagram. Alert thresholds (spike/drop %) are set there too.

## Features
- Overview with KPI cards + sparklines, growth chart (24h/7d/30d/all), platform split, fastest growing / top performing / needs attention
- Post detail: custom date range, hourly/daily/each-check granularity, total vs growth view, engagement rate
- Compare up to 6 posts (indexed growth or absolute); bulk pause/resume/campaign; search and filters; table or card view; light/dark theme
- Bulk-paste URLs (Instagram, YouTube watch / youtu.be / shorts, X), campaign tags, pause/delete, CSV export
- Account tracking (followers / subscribers over time), spike/drop alerts + optional Telegram push

## Local run
Website: `cd web`, copy `.env.local.example` to `.env.local` (fill in), `npm install`, `npm run dev` -> http://localhost:3000.
Scraper: `cd scraper`, put `SPREADSHEET_ID` and `GOOGLE_SERVICE_ACCOUNT_FILE=..\key.json` in `scraper/.env`, then `..\venv\Scripts\python.exe scrape.py`.
`..\venv\Scripts\python.exe selftest.py` checks the YouTube, X and Instagram scrapers. Set `SELENIUM_HEADLESS=0` to watch the browser.
(`archive/supabase/` holds an earlier version of the database; it is not used.)

## Know the limits
- **Selenium is slower than an API:** about 5-15 seconds per YouTube video, 1-4 seconds per X post and ~4 seconds per Instagram post. Fine for GitHub, and the reason posts are fetched only when due.
- **Instagram throttles bursts:** after roughly 10 page loads in a row from one address it redirects to its login page. So each run fetches at most 8 Instagram posts (stalest first, `MAX_IG_PER_RUN`), waits 6-10 s between them, and simply carries on next run; with 27 posts everything is refreshed within a few runs. Never-throttled numbers stay on the dashboard meanwhile.
- **Profile pages are login-walled for server IPs** (X and Instagram), so GitHub skips them (`SKIP_ACCOUNTS`). To get follower counts for those, schedule `scraper\run_scrape.bat` on a PC (it only fetches what is due).
- **Page layouts change:** if numbers stop appearing, run **selftest** (Actions tab) or `selftest.py` locally to see which scraper broke; the parsers are small and live in `scraper/youtube.py`, `twitter.py`, `instagram.py`.
- **Terms of service:** scraping public pages is against some sites' terms; this tool only reads what a logged-out visitor can see, at a low request rate.
- **Sheets quotas:** ~60 writes/min. The scraper batches everything into a few calls per run, so hundreds of posts are fine.
- GitHub cron can drift by minutes, and a repo with no commits for 60 days gets its scheduled workflows paused.
