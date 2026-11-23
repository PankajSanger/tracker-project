"""Offline tests for instagram.py using fake Graph API responses.   python -m unittest test_instagram_graph -v"""
import os
import unittest
from unittest import mock

import instagram as ig


class FakeResp:
    def __init__(self, data, status=200):
        self._d, self.status_code = data, status

    def json(self):
        return self._d


def media(code, likes, comments, user="owner", caption="cap"):
    return {"id": f"id_{code}", "shortcode": code, "permalink": f"https://www.instagram.com/p/{code}/",
            "like_count": likes, "comments_count": comments, "username": user, "caption": caption}


class GraphTests(unittest.TestCase):
    def setUp(self):
        ig.reset_cache()
        os.environ["IG_GRAPH_TOKEN"], os.environ["IG_USER_ID"] = "tok", "999"
        self.calls = []

    def run_with(self, router):
        def fake_get(url, params=None, timeout=None):
            self.calls.append((url, dict(params or {})))
            return router(url, params or {})
        return mock.patch.object(ig.requests, "get", side_effect=fake_get)

    def test_own_post_with_insights(self):
        def router(url, p):
            if url.endswith("/999") and p.get("fields") == "username": return FakeResp({"username": "me"})
            if url.endswith("/999/media"): return FakeResp({"data": [media("AAA", 120, 8, "me")]})
            if url.endswith("/id_AAA/insights"): return FakeResp({"data": [{"name": "views", "values": [{"value": 5000}]}, {"name": "shares", "values": [{"value": 12}]}]})
            raise AssertionError(url)
        with self.run_with(router):
            r = ig.fetch_post("AAA")
        self.assertEqual((r["likes"], r["comments"], r["views"], r["shares"], r["author"]), (120, 8, 5000, 12, "me"))

    def test_insights_fallback_when_metric_unsupported(self):
        def router(url, p):
            if url.endswith("/999") : return FakeResp({"username": "me"})
            if url.endswith("/999/media"): return FakeResp({"data": [media("AAA", 1, 1, "me")]})
            if p.get("metric") == "views,shares,reach,saved": return FakeResp({"error": {"code": 100, "message": "unsupported metric"}})
            if p.get("metric") == "views,reach": return FakeResp({"data": [{"name": "views", "values": [{"value": 77}]}]})
            raise AssertionError(p)
        with self.run_with(router):
            self.assertEqual(ig.fetch_post("AAA")["views"], 77)

    def test_other_account_found_on_second_page(self):
        def router(url, p):
            if url.endswith("/999/media"): return FakeResp({"data": []})
            if url.endswith("/999") and p.get("fields") == "username": return FakeResp({"username": "me"})
            f = p.get("fields", "")
            if "business_discovery.username(newsco)" in f and "media.after(" not in f:
                return FakeResp({"business_discovery": {"followers_count": 1000, "media": {"data": [media("X1", 5, 1, "newsco")], "paging": {"cursors": {"after": "CUR1"}}}}})
            if "media.after(CUR1)" in f:
                return FakeResp({"business_discovery": {"media": {"data": [media("TARGET", 4321, 99, "newsco", "hello world")], "paging": {}}}})
            raise AssertionError(f)
        with self.run_with(router):
            r = ig.fetch_post("TARGET", {"author": "NewsCo"})
            self.assertEqual((r["likes"], r["comments"], r["views"], r["author"]), (4321, 99, None, "newsco"))
            # a second post of the same account must come from the cache (no new discovery call)
            n = len(self.calls)
            ig.fetch_post("X1", {"author": "newsco"})
            self.assertEqual(len(self.calls), n)

    def test_missing_post_gives_clear_error(self):
        def router(url, p):
            if url.endswith("/999/media"): return FakeResp({"data": []})
            if url.endswith("/999"): return FakeResp({"username": "me"})
            return FakeResp({"business_discovery": {"media": {"data": [media("X1", 1, 1)], "paging": {}}}})
        with self.run_with(router), self.assertRaisesRegex(RuntimeError, "not found"):
            ig.fetch_post("NOPE", {"author": "someone"})

    def test_expired_token_is_an_auth_error(self):
        with self.run_with(lambda u, p: FakeResp({"error": {"code": 190, "message": "Error validating access token: Session has expired"}}, 400)):
            with self.assertRaises(ig.AuthError):
                ig.fetch_post("AAA")

    def test_rate_limit_is_distinct(self):
        with self.run_with(lambda u, p: FakeResp({"error": {"code": 4, "message": "Application request limit reached"}}, 400)):
            with self.assertRaises(ig.RateLimited):
                ig.fetch_post("AAA")

    def test_not_business_account(self):
        def router(url, p):
            if url.endswith("/999/media"): return FakeResp({"data": []})
            if "business_discovery" not in p.get("fields", "") and url.endswith("/999"): return FakeResp({"username": "me"})
            return FakeResp({"error": {"code": 110, "error_subcode": 2207013, "message": "Invalid user id: cannot find that business or creator account"}}, 400)
        with self.run_with(router), self.assertRaisesRegex(RuntimeError, "Business or Creator"):
            ig.fetch_post("AAA", {"author": "private_person"})

    def test_missing_credentials(self):
        os.environ.pop("IG_GRAPH_TOKEN")
        with self.assertRaises(ig.AuthError):
            ig.fetch_post("AAA")

    def test_profile_own_and_other(self):
        def router(url, p):
            if url.endswith("/999") and "followers_count" in p.get("fields", "") and "business_discovery" not in p["fields"]:
                return FakeResp({"username": "me", "followers_count": 50, "follows_count": 5, "media_count": 9})
            if "business_discovery.username(other)" in p.get("fields", ""):
                return FakeResp({"business_discovery": {"followers_count": 777, "follows_count": 3, "media_count": 40, "media": {"data": [], "paging": {}}}})
            raise AssertionError(p)
        with self.run_with(router):
            self.assertEqual(ig.fetch_profile("me")["followers"], 50)
            self.assertEqual(ig.fetch_profile("other"), {"followers": 777, "following": 3, "posts_count": 40})


if __name__ == "__main__":
    unittest.main()
