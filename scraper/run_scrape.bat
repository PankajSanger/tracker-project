@echo off
rem Hourly Instagram scrape run from this PC (Windows Task Scheduler runs this file).
rem GitHub Actions handles YouTube + X; Instagram stays here so the login session is only
rem ever used from this machine's address. Settings come from scraper\.env (git-ignored).
cd /d "%~dp0"
set PLATFORMS=instagram
set IG_BROWSER_FALLBACK=0
set PYTHONIOENCODING=utf-8
if not exist logs mkdir logs
"..\venv\Scripts\python.exe" scrape.py >> logs\scrape.log 2>&1
