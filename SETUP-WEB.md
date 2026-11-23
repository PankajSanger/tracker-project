# Social Tracker - Instagram, X and YouTube (Google Sheets + Vercel, free)

```
GitHub Actions + Apify  --fetches-->     Google Sheet (st_* tabs)  <--API routes--  Next.js site on Vercel
   scraper/scrape.py                      your spreadsheet                            web/   (team logins)
```
- **Data** lives in a Google Sheet you own. You can open it, filter it, chart it, export it.
- **Website** (Vercel) reads/writes the sheet through server-side API routes using a service account. The key never reaches the browser.
- **Collecting the numbers** (Python, `scraper/`):
  - **Numbers come from Apify actors** (apify.com scrapers, called over its API with `APIFY_TOKEN`). No browser, no Instagram login, no blocked server IPs.
    One Apify run per platform covers all posts that are due. Apify bills per result (see "Costs" below).
  - **GitHub Actions**, started every 15 minutes by cron-job.org (GitHub's own schedule only fires every few hours), does all the runs. Nothing needs to run on a PC.

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
| **X** (needs a paid Apify plan) | likes, replies, reposts, views | followers, following, posts |
| **Instagram** | exact likes, comments, creator, caption; exact views (plays) for every reel/video | exact followers, following, posts |

Actors used: `apify/instagram-scraper`, `apify/instagram-profile-scraper`, `streamers/youtube-scraper`,
`kaitoeasyapi/twitter-x-data-tweet-scraper-pay-per-result-cheapest`. Image posts have no views; Instagram **shares** are not available.
On Apify's **free plan every X actor returns only demo tweets**, so X posts show "X needs a paid Apify plan" until the account is upgraded.
Offline tests: `cd scraper`, `..\venv\Scripts\python.exe -m unittest test_apify_parse test_scrape_logic`.

## 3. GitHub (runs the scraper every 30 minutes - free)
1. Push this folder to a GitHub repo (`.gitignore` keeps keys and `.env` files out).
2. Settings -> Secrets and variables -> Actions -> **Secrets**:
   - `SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON` (whole key file contents), `APIFY_TOKEN` (apify.com -> Settings -> API & Integrations)
   - optional: `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` (phone alerts)
3. Actions tab -> **scrape** -> Run workflow (tick "force" to fetch every post now, ignoring the intervals).
4. **Reliable schedule (free):** GitHub's own cron fires only every few hours, so let cron-job.org start the workflow every 15 minutes:
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
Choose how often each platform is checked (15 minutes to 7 days) and override it per post on the post's page. Runs start every 15 minutes and fetch only posts that are
**due**, so the shortest real interval is ~15 minutes. **Check now** (post page, table row, or bulk) refreshes a post on the next run, within ~15 minutes.
Every check costs Apify credit, so longer intervals are cheaper.
**Follower tracking** (Settings) is separate: Daily, Weekly, Monthly or Yearly. Each account gets one snapshot per calendar day / week (Mon) /
month / year in India time, taken by the first run after midnight. A new account is checked on the next run.
**Delete** is on the post page header, on every table row, and in the bulk bar (history stays in the sheet). Defaults: 1 hour for YouTube and X, 3 hours for Instagram. Alert thresholds (spike/drop %) are set there too.

## Features
- Overview with KPI cards + sparklines, growth chart (24h/7d/30d/all), platform split, fastest growing / top performing / needs attention
- Post detail: custom date range, hourly/daily/each-check granularity, total vs growth view, engagement rate
- Compare up to 6 posts (indexed growth or absolute); bulk pause/resume/campaign; search and filters; table or card view; light/dark theme
- Bulk-paste URLs (Instagram, YouTube watch / youtu.be / shorts, X), campaign tags, pause/delete, CSV export
- Account tracking (followers / subscribers over time), spike/drop alerts + optional Telegram push
- Post thumbnails everywhere (tables, cards, reports)
- **Reports** page: a client-ready report per campaign (or all posts) with KPIs, growth chart, platform split and a content table.
  **Download PDF** prints it on A4. **New client link** makes a secret read-only link (no login, only that campaign, live numbers);
  links are listed per campaign and can be revoked any time.

## Local run
Website: `cd web`, copy `.env.local.example` to `.env.local` (fill in), `npm install`, `npm run dev` -> http://localhost:3000.
Scraper: `cd scraper`, put `SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_FILE=..\key.json` and `APIFY_TOKEN` in `scraper/.env`, then `..\venv\Scripts\python.exe scrape.py` (or `run_scrape.bat`).
`..\venv\Scripts\python.exe apify_api.py --check` checks the token (free).
(`archive/supabase/` holds an earlier version of the database; it is not used.)

## Know the limits
- **Costs:** Apify's free plan includes a small monthly credit (about $5). Roughly: Instagram posts ~$1.5-2.7 per 1,000 checks, X ~$0.25-0.40 per 1,000,
  YouTube similar to Instagram. Checks per month = posts x (43,200 / interval in minutes). Example: 10 Instagram posts every 30 min = 14,400 checks = ~$20-40/month;
  every 3 hours = 2,400 checks = ~$4-7/month. `APIFY_MAX_USD_PER_RUN` (default $0.50) caps a single actor run. Check usage at console.apify.com -> Billing.
- **Apify problems** (wrong token, credit used up, actor change) show up as "Apify: ..." in the post's error column and as a Telegram alert; old numbers stay.
- **Actors change:** if numbers stop appearing, check the actor's page on apify.com; the field mapping is small and lives in `scraper/youtube.py`, `twitter.py`, `instagram.py`.
- **Sheets quotas:** ~60 writes/min. The scraper batches everything into a few calls per run, so hundreds of posts are fine.
- GitHub cron can drift by minutes, and a repo with no commits for 60 days gets its scheduled workflows paused.
