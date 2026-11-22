@echo off
rem Scrape run from this PC (Windows Task Scheduler runs this every hour; only posts that are due are fetched).
rem GitHub Actions handles YouTube + X; Instagram stays here so the login session is only
rem ever used from this machine's address. Settings come from scraper\.env (git-ignored).
rem Optional argument overrides the platforms, e.g.  run_scrape.bat youtube
cd /d "%~dp0"
set PLATFORMS=instagram,youtube
if not "%~1"=="" set PLATFORMS=%~1
set IG_BROWSER_FALLBACK=0
set PYTHONIOENCODING=utf-8
if not exist logs mkdir logs
"..\venv\Scripts\python.exe" scrape.py >> logs\scrape.log 2>&1
