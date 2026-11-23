@echo off
rem Scrape run from this PC (Windows Task Scheduler runs this every hour; only posts that are due are fetched).
rem Same job as the GitHub Action, for running on your own PC (e.g. if GitHub is ever blocked by a site).
rem Settings come from scraper\.env (git-ignored).
rem Optional argument overrides the platforms, e.g.  run_scrape.bat youtube
cd /d "%~dp0"
set PLATFORMS=instagram,youtube,twitter
if not "%~1"=="" set PLATFORMS=%~1
set PYTHONIOENCODING=utf-8
if not exist logs mkdir logs
"..\venv\Scripts\python.exe" scrape.py >> logs\scrape.log 2>&1
