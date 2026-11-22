# Instagram Post Tracker

Production-ready tracker that reads Instagram post/reel URLs from a Google Sheet,
scrapes engagement metrics (likes, comments, views) on a configurable schedule, and
appends timestamped snapshots to a second sheet tab — fully automated after one manual login.

---

## Features

| Feature | Detail |
|---|---|
| **Sources** | Posts & Reels (URLs from Google Sheet) |
| **Metrics** | Likes · Comments · Views/Plays · Shares† · Saves† |
| **Persistence** | Appends rows; never overwrites history |
| **Session** | Login once; Chrome profile persists the session automatically |
| **Schedule** | Configurable interval (default 60 min); runs indefinitely |
| **Resilience** | Per-URL retries · rate-limit detection · login-expiry recovery |
| **Extraction** | GraphQL → JSON-LD → DOM fallback chain |

† Shares and Saves are not publicly accessible via Instagram; columns are reserved for future use.

---

## Project Structure

```
tracking/
├── instagram_tracker.py   # Main script
├── config.py              # All configuration (edit this first)
├── requirements.txt       # Python dependencies
├── README.md              # This file
├── service_account.json   # ← YOU create this (Google Cloud)
├── chrome_profile/        # Auto-created — persists Chrome session
├── instagram_cookies.json # Auto-created — fallback cookie store
└── logs/
    └── tracker.log        # Rotating log file
```

---

## Step 1 — Python Setup

```powershell
# Create and activate virtual environment (already done if you followed setup)
python -m venv venv
.\venv\Scripts\Activate.ps1

# Install all dependencies
pip install -r requirements.txt
```

---

## Step 2 — ChromeDriver Setup

`webdriver-manager` (included in requirements.txt) **automatically downloads the correct
ChromeDriver** for your installed Chrome version. No manual download needed.

> **Manual option** (if auto-download fails):
> 1. Check your Chrome version: `chrome://settings/help`
> 2. Download matching driver: https://googlechromelabs.github.io/chrome-for-testing/
> 3. Extract and set path in `config.py`:
>    ```python
>    CHROMEDRIVER_PATH = r"C:\chromedriver\chromedriver.exe"
>    ```

---

## Step 3 — Google Service Account Setup

### 3a. Create a Google Cloud Project
1. Go to https://console.cloud.google.com/
2. Click **New Project** → name it (e.g. `instagram-tracker`) → **Create**

### 3b. Enable APIs
1. Go to **APIs & Services → Library**
2. Search and enable:
   - **Google Sheets API**
   - **Google Drive API**

### 3c. Create a Service Account
1. Go to **APIs & Services → Credentials**
2. Click **+ CREATE CREDENTIALS → Service Account**
3. Name it `instagram-tracker-sa` → **Create and Continue** → **Done**
4. Click the service account email you just created
5. Go to the **Keys** tab → **Add Key → Create new key → JSON → Create**
6. The JSON file downloads automatically — **rename it `service_account.json`**
   and place it in the `C:\Pankaj\tracking\` folder

### 3d. Share the Google Sheet with the service account
1. Open your Google Spreadsheet
2. Click **Share**
3. Paste the service account email (looks like `instagram-tracker-sa@your-project.iam.gserviceaccount.com`)
4. Set permission to **Editor** → **Send**

---

## Step 4 — Google Sheet Setup

Create a Google Sheet named exactly: **`Instagram_Post_Tracker`**

### `input` tab — columns (Row 1 headers):

| Column | Description |
|---|---|
| `post_url` | Full Instagram URL e.g. `https://www.instagram.com/p/ABC123/` |
| `creator_name` | Any label for the creator |
| `content_type` | `post` or `reel` |
| `active` | `TRUE` to track, `FALSE` to skip |

**Example rows:**
```
post_url                                    creator_name   content_type   active
https://www.instagram.com/p/ABC123/         nike           post           TRUE
https://www.instagram.com/reel/XYZ789/      adidas         reel           TRUE
https://www.instagram.com/p/OLD001/         old_brand      post           FALSE
```

### `tracking_data` tab — auto-created with headers:

```
scrape_time | creator_name | post_url | shortcode | content_type |
likes | comments | views | shares | saves
```

> Both tabs are created automatically on first run if they don't exist.

---

## Step 5 — Configuration

Edit `config.py` to customise behaviour:

```python
# How often to scrape (minutes)
TRACKING_INTERVAL_MINUTES = 60

# Set True to run Chrome without a visible window (harder to scrape headlessly)
HEADLESS_MODE = False

# Leave blank to auto-download chromedriver
CHROMEDRIVER_PATH = ""

# Path to your service account JSON
SERVICE_ACCOUNT_FILE = "service_account.json"

# Exact name of your Google Spreadsheet
SPREADSHEET_NAME = "Instagram_Post_Tracker"
```

You can also set these as environment variables instead of editing the file:

```powershell
$env:TRACKING_INTERVAL_MINUTES = "30"
$env:HEADLESS_MODE = "false"
$env:LOG_LEVEL = "DEBUG"
```

---

## Step 6 — Run the Tracker

```powershell
# Make sure venv is active
.\venv\Scripts\Activate.ps1

# Start the tracker
python instagram_tracker.py
```

### First run:
1. Chrome opens automatically
2. You are prompted to **log into Instagram manually** in the browser
3. Complete login (including any 2FA)
4. The script detects login and continues — **no action needed after this**

### Subsequent runs:
- Chrome loads the saved profile/cookies silently
- Scraping starts immediately with no manual intervention
- Runs every `TRACKING_INTERVAL_MINUTES` minutes indefinitely
- Press **Ctrl+C** to stop

---

## Keeping it running (optional)

### Windows Task Scheduler (recommended for 24/7)
1. Open Task Scheduler → **Create Basic Task**
2. Trigger: Daily, repeat every 1 hour
3. Action: Start a program
   - Program: `C:\Pankaj\tracking\venv\Scripts\python.exe`
   - Arguments: `C:\Pankaj\tracking\instagram_tracker.py`
   - Start in: `C:\Pankaj\tracking`

### Run in background (PowerShell)
```powershell
Start-Process python -ArgumentList "instagram_tracker.py" `
    -WorkingDirectory "C:\Pankaj\tracking" `
    -WindowStyle Hidden
```

---

## Logs

All activity is logged to `logs/tracker.log` (rotating, max 5 MB × 5 files)
and also printed to the console.

```
2025-01-01 12:00:00 | INFO     | run_tracking_job        | Tracking job started — 2025-01-01 12:00:00
2025-01-01 12:00:05 | INFO     | scrape_post             | Result [ABC123] likes=1234 | comments=56 | views=None
2025-01-01 12:00:23 | INFO     | append_to_tracking_sheet| Tracking sheet updated — 3 new rows | 147 total rows.
```

To watch logs live:
```powershell
Get-Content logs\tracker.log -Wait -Tail 40
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `FileNotFoundError: service_account.json` | Place your service account JSON in the project folder and verify `SERVICE_ACCOUNT_FILE` in config.py |
| `SpreadsheetNotFound` | Make sure the spreadsheet name in config.py matches exactly, and you've shared it with the service account email |
| `SessionNotCreatedException` | Chrome version mismatch — run `pip install --upgrade webdriver-manager` |
| Script redirects to Instagram login every run | Delete `chrome_profile/` folder and log in again |
| `likes = None` for all posts | Instagram may have "Hidden Likes" enabled for those accounts, or you need to be logged in as a follower |
| Rate limit / "Try again later" | Increase `BETWEEN_POSTS_DELAY` in config.py or reduce how many posts you track |
| Headless mode not working | Keep `HEADLESS_MODE = False` — Instagram actively blocks headless browsers |

---

## Notes on Data Availability

- **Likes** — visible when logged in; hidden if the creator has enabled "Hide like count"
- **Comments** — always visible (count shown on post page)
- **Views / Plays** — only available for Reels and video posts, not static images
- **Shares** — Instagram does not expose this publicly; column always `None`
- **Saves** — Instagram does not expose this publicly; column always `None`
