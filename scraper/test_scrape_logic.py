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


class AccountPeriods(unittest.TestCase):
    IST = timezone(timedelta(hours=5, minutes=30))

    def at(self, *a):
        return datetime(*a, tzinfo=self.IST)

    def test_daily_uses_india_calendar_days(self):
        last = self.at(2026, 11, 23, 0, 5).isoformat()
        self.assertFalse(scrape.account_due(last, 1, self.at(2026, 11, 23, 23, 55)))  # same day: no
        self.assertTrue(scrape.account_due(last, 1, self.at(2026, 11, 24, 0, 2)))     # just after midnight IST: yes

    def test_weekly_monthly_yearly(self):
        last = self.at(2026, 11, 23, 0, 5).isoformat()  # a Monday
        self.assertFalse(scrape.account_due(last, 7, self.at(2026, 11, 29, 23, 0)))   # Sunday, same ISO week
        self.assertTrue(scrape.account_due(last, 7, self.at(2026, 11, 30, 0, 10)))    # next Monday
        self.assertFalse(scrape.account_due(last, 30, self.at(2026, 11, 30, 12, 0)))
        self.assertTrue(scrape.account_due(last, 30, self.at(2026, 12, 1, 0, 10)))
        self.assertFalse(scrape.account_due(last, 365, self.at(2026, 12, 31, 23, 0)))
        self.assertTrue(scrape.account_due(last, 365, self.at(2027, 1, 1, 0, 10)))

    def test_never_checked_is_due(self):
        self.assertTrue(scrape.account_due(None, 30))


if __name__ == "__main__":
    unittest.main()
