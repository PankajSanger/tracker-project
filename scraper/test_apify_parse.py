"""Offline tests for mapping Apify actor items to our metrics.   python -m unittest test_apify_parse -v"""
import unittest
from unittest import mock

import instagram as ig
import twitter as tw
import youtube as yt
from apify_api import ApifyError


class InstagramMapping(unittest.TestCase):
    def test_reel_views_likes_comments(self):
        d = ig.map_post({"shortCode": "Df9", "likesCount": 5912, "commentsCount": 94, "videoPlayCount": 4390047,
                         "videoViewCount": 1200000, "ownerUsername": "burgerkingindia", "caption": "hi\nthere", "displayUrl": "https://cdn/x.jpg"})
        self.assertEqual((d["likes"], d["comments"], d["views"], d["author"], d["title"]), (5912, 94, 4390047, "burgerkingindia", "hi there"))
        self.assertEqual(d["thumbnail"], "https://cdn/x.jpg")

    def test_image_has_no_views_and_hidden_likes(self):
        d = ig.map_post({"likesCount": -1, "commentsCount": 9})
        self.assertEqual((d["likes"], d["comments"], d["views"]), (None, 9, None))

    def test_fetch_posts_matches_and_flags_missing(self):
        items = [{"shortCode": "AAA", "likesCount": 1, "commentsCount": 2},
                 {"inputUrl": "https://www.instagram.com/p/BBB/", "error": "not_found", "errorDescription": "Post not found"}]
        with mock.patch.object(ig, "run_actor", return_value=items):
            out = ig.fetch_posts(["AAA", "BBB", "CCC"])
        self.assertEqual(out["AAA"]["likes"], 1)
        self.assertIn("unavailable", str(out["BBB"]))
        self.assertIn("unavailable", str(out["CCC"]))

    def test_profile(self):
        with mock.patch.object(ig, "run_actor", return_value=[{"username": "Raymond", "followersCount": 483174, "followsCount": 78, "postsCount": 3385}]):
            out = ig.fetch_profiles(["@raymond", "ghost"])
        self.assertEqual(out["@raymond"], {"followers": 483174, "following": 78, "posts_count": 3385})
        self.assertIsInstance(out["ghost"], Exception)

    def test_parse_url(self):
        self.assertEqual(ig.parse_url("https://www.instagram.com/reel/Abc_12-x/?igsh=1"), "Abc_12-x")
        self.assertEqual(ig.parse_url("https://www.instagram.com/someone/p/ZZZ9/"), "ZZZ9")
        self.assertIsNone(ig.parse_url("https://example.com/p/1"))


class YouTubeMapping(unittest.TestCase):
    def test_video(self):
        with mock.patch.object(yt, "run_actor", return_value=[{"id": "BUoni23eKTY", "viewCount": 158230, "likes": 3500, "commentsCount": 530, "channelName": "Trustified", "title": "T"}]):
            out = yt.fetch_posts(["BUoni23eKTY", "zzzzzzzzzzz"])
        self.assertEqual((out["BUoni23eKTY"]["views"], out["BUoni23eKTY"]["likes"], out["BUoni23eKTY"]["comments"]), (158230, 3500, 530))
        self.assertIsInstance(out["zzzzzzzzzzz"], Exception)


class TwitterMapping(unittest.TestCase):
    def test_tweet(self):
        item = {"id": "123", "likeCount": 10, "replyCount": 2, "retweetCount": 3, "viewCount": 900, "author": {"userName": "NASA", "profilePicture": "https://pic"}, "text": "x"}
        with mock.patch.object(tw, "run_actor", return_value=[item]):
            out = tw.fetch_posts(["123"])
        self.assertEqual(out["123"], {"likes": 10, "comments": 2, "views": 900, "shares": 3, "author": "NASA", "title": "x", "thumbnail": "https://pic"})

    def test_free_plan_mock_is_an_apify_error(self):
        with mock.patch.object(tw, "run_actor", return_value=[{"type": "mock_tweet", "id": -1}]):
            with self.assertRaises(ApifyError):
                tw.fetch_posts(["123"])


if __name__ == "__main__":
    unittest.main()
