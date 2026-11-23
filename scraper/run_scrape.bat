@echo off
rem Manual scrape run from this PC (same job as the GitHub Action; only posts that are due are fetched).
rem The scheduled runs happen on GitHub now - this is just for testing. Numbers come from Apify (APIFY_TOKEN in .env).
rem Settings come from scraper\.env (git-ignored).
rem Optional argument overrides the platforms, e.g.  run_scrape.bat youtube
cd /d "%~dp0"
set PLATFORMS=instagram,youtube,twitter
if not "%~1"=="" set PLATFORMS=%~1
set PYTHONIOENCODING=utf-8
if not exist logs mkdir logs
"..\venv\Scripts\python.exe" scrape.py >> logs\scrape.log 2>&1
