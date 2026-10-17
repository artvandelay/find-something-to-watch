#!/usr/bin/env python3
import unittest

from build_free_sources import (
    RECORD_KEYS,
    build_records,
    classify_url,
    localize_link,
    normalize_url,
    parse_audiobooks,
    parse_movies,
    parse_podcasts,
    parse_youtube_availability,
    probe_records,
    youtube_decision,
)

PODCASTS = """
<h2>Ideas</h2>
<p><strong>Radiolab</strong> — <a href="https://podcasts.apple.com/us/podcast/radiolab/id152249110">Apple</a>
 — <a href="https://podcasts.google.com/feed/x">Google</a>
 — <a href="https://feeds.example.test/radiolab">RSS</a>
 — Ideas worth hearing.</p>
<h2>Essentials</h2>
<p><strong>Skip Me</strong> — <a href="https://example.test/skip">Web</a></p>
"""

MOVIES = """
<h2>Free Comedy &amp; Dramas</h2>
<ul>
<li><strong>How to watch hundreds of films</strong> — <a href="https://example.test/guide">Free</a></li>
<li><strong><span><strong>A Star is Born (1937)</strong> — <a href="https://www.youtube.com/watch?v=fixtureStar1">Free</a>
 — <a href="https://example.test/ebook">Free eBooks</a></span></strong></li>
<li><strong>125 Korean Feature Films</strong> — <a href="https://example.test/set">Free</a></li>
</ul>
<h2>Essentials</h2>
<ul><li><strong>After</strong> — <a href="https://example.test/after">Free</a></li></ul>
"""

AUDIOBOOKS = """
<ul>
<li><strong>Aesop</strong> — Aesop's Fables —
 <a href="http://itunes.apple.com/WebObjects/MZStore.woa/wa/viewPodcast?id=255293600">Free iTunes</a> —
 <a href="http://archive.org/details/aesop">Free MP3</a> —
 <a href="https://example.test/book">Free eBook</a>
</li>
<li><a href="https://example.test/nav">Home</a></li>
</ul>
"""


class FreeSourcesTest(unittest.TestCase):
    def test_classify_and_normalize(self):
        cases = {
            "https://www.youtube.com/watch?v=abc": "free_youtube",
            "https://youtu.be/abc": "free_youtube",
            "https://music.youtube.com/watch?v=abc": "free_youtube",
            "https://vimeo.com/1": "free_vimeo",
            "https://archive.org/details/x": "free_archive",
            "https://librivox.org/x": "free_librivox",
            "https://open.spotify.com/show/x": "free_spotify",
            "https://podcasts.apple.com/us/podcast/x/id1": "free_apple",
            "https://itunes.apple.com/x": "free_apple",
            "https://www.openculture.com/x": "free_openculture",
            "https://podcasts.google.com/x": None,
            "https://example.test/feed": "free_web",
        }
        for url, slug in cases.items():
            self.assertEqual(classify_url(url, None), slug, url)
        self.assertEqual(classify_url("https://example.test/feed", "RSS"), "free_rss")
        self.assertEqual(
            normalize_url("http://podcasts.apple.com/us/podcast/x/id1"),
            "https://podcasts.apple.com/in/podcast/x/id1",
        )

    def test_podcasts(self):
        entries = parse_podcasts(PODCASTS)
        self.assertEqual([entry["title"] for entry in entries], ["Radiolab"])
        self.assertEqual(entries[0]["category"], "Ideas")
        records = build_records("podcast", entries)
        self.assertEqual(list(records[0].keys()), RECORD_KEYS)
        self.assertNotIn("free_apple", [])  # rewritten, not dropped
        self.assertEqual(records[0]["p"], ["free_apple", "free_rss"])
        self.assertTrue(records[0]["u"]["free_apple"].startswith("https://podcasts.apple.com/in/"))

    def test_movies(self):
        entries = parse_movies(MOVIES)
        self.assertEqual([entry["title"] for entry in entries], ["A Star is Born (1937)"])
        records = build_records("movie", entries)
        self.assertEqual(records[0]["y"], 1937)
        self.assertEqual(records[0]["k"], "movie")
        self.assertEqual(records[0]["p"], ["free_youtube"])
        self.assertEqual(records[0]["img"], "https://i.ytimg.com/vi/fixtureStar1/hqdefault.jpg")
        self.assertEqual(records[0]["g"], ["Comedy & Dramas"])
        self.assertEqual(len(records[0]), 14)

    def test_audiobooks(self):
        entries = parse_audiobooks(AUDIOBOOKS)
        self.assertEqual(entries[0]["author"], "Aesop")
        self.assertEqual(entries[0]["title"], "Aesop's Fables")
        self.assertTrue(all("ebook" not in link["label"].lower() for link in entries[0]["links"]))
        records = build_records("audiobook", entries)
        self.assertEqual(records[0]["s"], "Audiobook by Aesop.")
        self.assertEqual(records[0]["g"], [])
        self.assertIn("free_archive", records[0]["p"])

    def test_probe_drops_404(self):
        records = build_records("podcast", parse_podcasts(PODCASTS))

        def checker(_slug, url):
            return "dead" if "feeds.example.test" in url else "ok"

        kept, stats = probe_records(records, checker=checker)
        self.assertEqual(stats["dropped"], 1)
        self.assertEqual(kept[0]["p"], ["free_apple"])
        self.assertEqual(kept[0]["u"]["free_apple"]["checkedIn"], "IN")

    def test_available_countries_and_localize(self):
        html = (
            '{"playabilityStatus":{"status":"OK","playableInEmbed":true},'
            '"availableCountries":["IN","US","GB"]}'
        )
        status, countries = parse_youtube_availability(html)
        self.assertEqual(status, "OK")
        self.assertEqual(countries, ["IN", "US", "GB"])
        regions, drop = youtube_decision(html)
        self.assertEqual(regions, ["IN", "US", "GB"])
        self.assertFalse(drop)
        unplayable = '{"playabilityStatus":{"status":"UNPLAYABLE"}}'
        regions, drop = youtube_decision(unplayable)
        self.assertEqual(regions, [])
        self.assertTrue(drop)
        unknown = "<html>no player</html>"
        regions, drop = youtube_decision(unknown)
        self.assertEqual(regions, [])
        self.assertFalse(drop)
        self.assertEqual(
            localize_link("https://podcasts.apple.com/in/podcast/x/id1", "US"),
            "https://podcasts.apple.com/us/podcast/x/id1",
        )
        self.assertEqual(
            localize_link("https://books.apple.com/GB/book/x/id1", "in"),
            "https://books.apple.com/in/book/x/id1",
        )
        self.assertEqual(
            localize_link("https://itunes.apple.com/us/podcast/x/id1", "AE"),
            "https://itunes.apple.com/ae/podcast/x/id1",
        )
        self.assertEqual(
            localize_link("https://itunes.apple.com/WebObjects/MZStore.woa/wa/viewPodcast?id=1", "US"),
            "https://itunes.apple.com/WebObjects/MZStore.woa/wa/viewPodcast?id=1",
        )


if __name__ == "__main__":
    unittest.main()
