"""Offline tests for the 'is this post due' logic.   python -m unittest test_scrape_logic"""
import os
import unittest
from datetime import datetime, timedelta, timezone

os.environ.setdefault("PLATFORMS", "youtube")
import scrape


def ago(minutes):
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat(timespec="seconds")


class DueLogic(unittest.TestCase):
    def test_never_checked_is_due(self):
        self.assertTrue(scrape.is_due(None, 60))

    def test_recent_check_is_not_due(self):
        self.assertFalse(scrape.is_due(ago(10), 60))

    def test_old_check_is_due(self):
        self.assertTrue(scrape.is_due(ago(200), 60))

    def test_cron_jitter_tolerance(self):
        self.assertTrue(scrape.is_due(ago(55), 60))   # 55 min >= 85% of 60
        self.assertFalse(scrape.is_due(ago(45), 60))

    def test_interval_precedence(self):
        post = {"platform": "youtube", "interval_min": "300"}
        self.assertEqual(scrape.interval_minutes(post, {"interval_youtube": "30"}), 300)          # per-post override wins
        self.assertEqual(scrape.interval_minutes({"platform": "youtube"}, {"interval_youtube": "30"}), 30)  # then the dashboard setting
        self.assertEqual(scrape.interval_minutes({"platform": "instagram"}, {}), 180)                      # then the built-in default


if __name__ == "__main__":
    unittest.main()
