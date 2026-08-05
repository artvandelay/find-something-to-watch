import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { toMarkdown, toJson, toCsv, toYouMd } from "../docs/js/exporters.js";

const picks = [
  {
    id: "netflix:1",
    t: "Space Heist",
    y: 2020,
    k: "movie",
    rt: 100,
    r: 7.2,
    p: ["netflix"],
    l: "en",
    g: ["Comedy", "Crime"],
    u: { netflix: "https://x/1" },
    img: null,
    s: "A crew pulls off a daring space robbery.",
    reason: "A tight, funny heist"
  },
  {
    id: "netflix:2",
    t: 'Slow, "Burn"',
    y: null,
    k: "series",
    rt: null,
    r: null,
    p: ["netflix"],
    l: null,
    g: [],
    u: { netflix: "https://x/2" },
    img: null,
    s: "A slow-burn mystery.",
    reason: "Line one\nline two"
  }
];
const meta = { query: "something fun", generatedAt: "2026-08-04T00:00:00Z" };

const md = toMarkdown(picks, meta);
ok(md.startsWith("# Watch picks"));
ok(md.includes("## 1. Space Heist (2020)"));
ok(md.includes("TMDB 7.2"));
ok(md.includes("[Find on Netflix](https://x/1)"));
ok(md.includes("- Description: A crew pulls off a daring space robbery."));
ok(!md.includes("(null)"));
ok(!md.includes("null min"));

strictEqual(toMarkdown([], meta), "# Watch picks\n\nNo results.\n");
const playlistMeta = {
  title: "Friday films",
  playlist: { id: "friday", name: "Friday films" },
  unavailableIds: ["tmdb:m404"]
};
const playlistMarkdown = toMarkdown([{ ...picks[0], query: "", reason: "" }], playlistMeta);
ok(playlistMarkdown.startsWith("# Friday films\n"));
ok(!playlistMarkdown.includes("> Query:"));
ok(!playlistMarkdown.includes("- Why:"));

const j = JSON.parse(toJson(picks, meta));
strictEqual(j.picks.length, 2);
strictEqual(j.query, "something fun");
const playlistJson = JSON.parse(toJson(picks, playlistMeta));
deepStrictEqual(playlistJson.playlist, playlistMeta.playlist);
deepStrictEqual(playlistJson.unavailableIds, ["tmdb:m404"]);
strictEqual(playlistJson.title, "Friday films");

const csv = toCsv(picks, meta);
const lines = csv.trimEnd().split("\n");
strictEqual(lines[0], "id,title,year,kind,runtime_min,rating,language,genre,providers,url,description,reason");
ok(lines[1].includes("en"));
ok(lines[1].includes("Comedy; Crime"));
ok(lines[1].includes("Netflix"));
ok(lines[1].includes("A crew pulls off a daring space robbery."));
ok(csv.includes('"Slow, ""Burn"""'));
ok(csv.includes('"Line one\nline two"'));
ok(csv.endsWith("\n"));

const injectionCsv = toCsv([{ ...picks[0], t: "=HYPERLINK(\"http://evil\")", reason: "@SUM(1,1)" }], meta);
ok(injectionCsv.includes("'=HYPERLINK"));
ok(injectionCsv.includes("'@SUM(1,1)"));

const y1 = toYouMd("# You.md\n\n## What I love\n- heists\n", {
  series: [{ name: "Seinfeld", episodes: 79 }],
  movies: [{ title: "Gunday" }]
});
ok(y1.includes("## Recently watched"));
ok(y1.includes("- Seinfeld — 79 episodes"));
ok(y1.includes("- Gunday"));

const y2 = toYouMd(y1, { series: [{ name: "Seinfeld", episodes: 79 }], movies: [] });
strictEqual(y2.split("## Recently watched").length, 2);

ok(!toYouMd("# You.md\n", null).includes("## Recently watched"));

console.log("check_exporters OK");
