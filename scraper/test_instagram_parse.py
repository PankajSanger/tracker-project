"""Offline tests for the Instagram page parser.   python -m unittest test_instagram_parse -v"""
import unittest

from bs4 import BeautifulSoup

import instagram as ig


def page(og=None, scripts=()):
    head = f'<meta property="og:description" content="{og}">' if og else ""
    body = "".join(f"<script>{s}</script>" for s in scripts)
    return BeautifulSoup(f"<html><head>{head}</head><body>{body}</body></html>", "lxml")


class PostParsing(unittest.TestCase):
    def test_abbreviated_summary_resolved_to_exact_numbers(self):
        s = page('79K likes, 355 comments - liveupdate09 on August 1, 2026: &quot;hello #tag&quot;',
                 ['{"like_count":5,"comment_count":1}', '{"like_count":79316,"comment_count":355}'])
        r = ig.parse_post(s)
        self.assertEqual((r["likes"], r["comments"], r["author"], r["title"]), (79316, 355, "liveupdate09", "hello #tag"))
        self.assertIsNone(r["views"])

    def test_small_exact_numbers(self):
        s = page('1,931 likes, 27 comments - live_mint on July 28, 2026: &quot;x&quot;', ['{"like_count":1931,"comment_count":27}'])
        r = ig.parse_post(s)
        self.assertEqual((r["likes"], r["comments"]), (1931, 27))

    def test_falls_back_to_summary_when_json_missing(self):
        r = ig.parse_post(page('2.5K likes, 40 comments - someone on May 3, 2026: &quot;c&quot;'))
        self.assertEqual((r["likes"], r["comments"]), (2500, 40))

    def test_hidden_likes(self):
        s = page('27 comments - someone on May 3, 2026: &quot;c&quot;', ['{"like_and_view_counts_disabled":true,"like_count":0,"comment_count":27}'])
        r = ig.parse_post(s)
        self.assertIsNone(r["likes"])
        self.assertEqual(r["comments"], 27)

    def test_unavailable_page_returns_none(self):
        self.assertIsNone(ig.parse_post(page()))

    def test_unrelated_json_number_is_ignored(self):
        # a "like_count" of a different post that does not match the summary must not win
        s = page('150 likes, 3 comments - u on May 3, 2026: &quot;c&quot;', ['{"like_count":987654}'])
        self.assertEqual(ig.parse_post(s)["likes"], 150)


class ProfileParsing(unittest.TestCase):
    OG = "{} Followers, 11 Following, 2,878 Posts - See Instagram photos and videos from X (@x)"

    def test_coarse_rounding_resolved(self):
        r = ig.parse_profile(page(self.OG.format("2M"), ['{"follower_count":1767827}']))
        self.assertEqual((r["followers"], r["following"], r["posts_count"]), (1767827, 11, 2878))

    def test_json_far_from_summary_is_rejected(self):
        self.assertEqual(ig.parse_profile(page(self.OG.format("2M"), ['{"follower_count":50}']))["followers"], 2000000)

    def test_missing_profile(self):
        self.assertIsNone(ig.parse_profile(page()))


class Numbers(unittest.TestCase):
    def test_abbr(self):
        self.assertEqual(ig._abbr("1,931"), 1931)
        self.assertEqual(ig._abbr("79K"), 79000)
        self.assertEqual(ig._abbr("1.5M"), 1500000)
        self.assertEqual(ig._abbr_tol("2M"), (2000000, 500001))

    def test_url(self):
        self.assertEqual(ig.parse_url("https://www.instagram.com/reel/Abc_12-x/?igsh=1"), "Abc_12-x")
        self.assertEqual(ig.parse_url("https://www.instagram.com/someone/p/ZZZ9/"), "ZZZ9")
        self.assertIsNone(ig.parse_url("https://example.com/p/1"))


if __name__ == "__main__":
    unittest.main()
