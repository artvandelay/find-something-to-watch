import { ok, strictEqual } from "node:assert/strict";
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
    u: { netflix: "https://x/1" },
    img: null,
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
    u: { netflix: "https://x/2" },
    img: null,
    reason: "Line one\nline two"
  }
];
const meta = { query: "something fun", generatedAt: "2026-08-04T00:00:00Z" };

const md = toMarkdown(picks, meta);
ok(md.startsWith("# Watch picks"));
ok(md.includes("## 1. Space Heist (2020)"));
ok(md.includes("IMDb 7.2"));
ok(md.includes("[Netflix](https://x/1)"));
ok(!md.includes("(null)"));
ok(!md.includes("null min"));

strictEqual(toMarkdown([], meta), "# Watch picks\n\nNo results.\n");

const j = JSON.parse(toJson(picks, meta));
strictEqual(j.picks.length, 2);
strictEqual(j.query, "something fun");

const csv = toCsv(picks);
const lines = csv.trimEnd().split("\n");
strictEqual(lines[0], "id,title,year,kind,runtime_min,rating,providers,url,reason");
ok(csv.includes('"Slow, ""Burn"""'));
ok(csv.includes('"Line one\nline two"'));
ok(csv.endsWith("\n"));

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
