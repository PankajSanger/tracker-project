# Social Tracker - Instagram, X and YouTube (Google Sheets + Vercel, free)

```
GitHub Actions (+ your PC)  --scrapes-->  Google Sheet (st_* tabs)  <--API routes--  Next.js site on Vercel
   scraper/scrape.py                      your spreadsheet                            web/   (team logins)
```
- **Data** lives in a Google Sheet you own. You can open it, filter it, chart it, export it.
- **Website** (Vercel) reads/writes the sheet through server-side API routes using a service account. The key never reaches the browser.
- **Collecting the numbers** (Python, `scraper/`):
  - **YouTube and X:** Selenium (headless Chrome) + Beautiful Soup. No login, no API keys.
  - **Instagram:** the official **Instagram Graph API** (Meta). No scraping, no session cookie.
  - Runs on GitHub Actions every 30 minutes (free), and optionally on a PC (`run_scrape.bat`) for the things GitHub's IPs cannot read (see "Know the limits").

## 1. The spreadsheet
Use your existing `tracking` spreadsheet or a new one. The app only creates and touches its own tabs, named `st_posts`, `st_snapshots`,
`st_summary`, `st_accounts`, `st_account_snapshots`, `st_alerts`, `st_settings`. Your old `input` and `tracking_data` tabs are never modified.
1. Copy the spreadsheet ID from its URL: `docs.google.com/spreadsheets/d/<THIS PART>/edit`.
2. Share it (Editor) with your service account's email (`client_email` inside the key JSON). The Google Sheets API must be enabled for that Google Cloud project.
3. Optional - bring over your old tracked posts: `cd scraper`, then `..\venv\Scripts\python.exe import_input.py` (preview) and `... import_input.py --apply`.

Capacity: a Google Sheet holds 10 million cells. One snapshot = 6 cells, so 100 posts tracked hourly use ~14,000 cells/day (about 2 years of room).

## 2. Instagram Graph API setup (one time)
The Graph API only works with **Instagram Business or Creator accounts** that are linked to a Facebook Page.
1. Create a Meta app at developers.facebook.com (type "Business"), add the **Instagram Graph API** product.
2. Get a **long-lived access token** for the Instagram account/Page with the permissions `instagram_basic`, `pages_show_list`, `pages_read_engagement`, `instagram_manage_insights` (Graph API Explorer -> generate token -> exchange for a long-lived one; page tokens do not expire, user tokens last ~60 days).
3. Find the **Instagram Business Account id**: `GET /me/accounts` -> the page id, then `GET /{page-id}?fields=instagram_business_account`.
4. Save both as GitHub secrets: `IG_GRAPH_TOKEN` and `IG_USER_ID` (and in `scraper/.env` for local runs).

What it can read:
- **Your own account's posts:** likes, comments and insights (views, shares, reach, saves).
- **Other public Business/Creator accounts' posts** (Business Discovery): likes and comments only (no views/shares), found by scanning that account's latest 500 posts for the post. The post's creator must be known: it is filled from the sheet's creator name, or looked up by oEmbed.
- **Personal accounts** cannot be read at all by the Graph API.
Run `python -m unittest test_instagram_graph` in `scraper/` for the offline tests of this module.

## 3. GitHub (runs the scraper every 30 minutes - free)
1. Push this folder to a GitHub repo (`.gitignore` keeps keys and `.env` files out).
2. Settings -> Secrets and variables -> Actions -> **Secrets**:
   - `SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON` (whole key file contents)
   - `IG_GRAPH_TOKEN`, `IG_USER_ID` (Instagram is included automatically once `IG_GRAPH_TOKEN` exists)
   - optional: `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` (phone alerts)
3. Actions tab -> **selftest** -> Run workflow: tries a known YouTube video/channel and X post/profile with Selenium from GitHub's servers (writes nothing) and prints OK/FAIL for each.
4. Actions tab -> **scrape** -> Run workflow (manual runs ignore the intervals). It then runs every 30 minutes by itself.

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
Choose how often each platform is checked (15 minutes to 7 days) and override it per post on the post's page. The runner wakes every 30 minutes and each post is
only fetched when it is **due**, so the real minimum is 30 minutes. Defaults: 1 hour for every platform. Alert thresholds (spike/drop %) are set there too.

## Features
- Overview with KPI cards + sparklines, growth chart (24h/7d/30d/all), platform split, fastest growing / top performing / needs attention
- Post detail: custom date range, hourly/daily/each-check granularity, total vs growth view, engagement rate
- Compare up to 6 posts (indexed growth or absolute); bulk pause/resume/campaign; search and filters; table or card view; light/dark theme
- Bulk-paste URLs (Instagram, YouTube watch / youtu.be / shorts, X), campaign tags, pause/delete, CSV export
- Account tracking (followers / subscribers over time), spike/drop alerts + optional Telegram push

## Local run
Website: `cd web`, copy `.env.local.example` to `.env.local` (fill in), `npm install`, `npm run dev` -> http://localhost:3000.
Scraper: `cd scraper`, put `SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_FILE=..\key.json` (and `IG_GRAPH_TOKEN`, `IG_USER_ID`) in `scraper/.env`, then `..\venv\Scripts\python.exe scrape.py`.
`..\venv\Scripts\python.exe selftest.py` checks the YouTube and X scrapers. Set `SELENIUM_HEADLESS=0` to watch the browser.
(`archive/supabase/` holds an earlier version of the database; it is not used.)

## Know the limits
- **Selenium is slower than an API:** about 5-15 seconds per YouTube video and 1-4 seconds per X post, so 100 posts take several minutes per run. Fine for GitHub, but it is why posts are fetched only when due.
- **YouTube** (Selenium): views, likes, comments, title, channel; subscribers per channel. Page layouts change over time, so if numbers stop appearing run `selftest.py` first.
- **X** (Selenium, no login): exact likes, replies, reposts; views only on newer posts. Follower counts are abbreviated by X (e.g. 92.1M) and **X profile pages are login-walled from GitHub's servers**, so GitHub skips X accounts (`SKIP_ACCOUNTS=twitter`). Run `scraper\run_scrape.bat` on a PC (Task Scheduler, hourly) if you want X follower counts.
- **Instagram** (Graph API): see section 2 for what is and is not readable. Tokens expire (user tokens ~60 days): the dashboard shows "token problem" and you replace the secret.
- **Sheets quotas:** ~60 writes/min. The scraper batches everything into a few calls per run, so hundreds of posts are fine.
- GitHub cron can drift by minutes, and a repo with no commits for 60 days gets its scheduled workflows paused.
