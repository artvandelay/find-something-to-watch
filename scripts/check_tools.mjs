import { strictEqual, deepStrictEqual, ok } from "node:assert/strict";
import { createTools } from "../docs/js/tools.js";
import { buildIndex, search, filterIndices, normalizeTitle } from "../docs/js/catalog.js";

const recs = [
  { id: "netflix:1", t: "Space Heist", y: 2020, k: "movie", rt: 100,
    s: "A crew of thieves plan a daring heist aboard a space station.",
    im: null, r: 7.2, p: ["netflix"], u: { netflix: "https://x/1" }, img: null,
    l: "en", g: ["Crime"], v: 10 },
  { id: "netflix:2", t: "Slow Burn", y: 2015, k: "series", rt: 45,
    s: "A quiet detective story about a small town and a long grudge.",
    im: null, r: 8.1, p: ["netflix"], u: { netflix: "https://x/2" }, img: null,
    l: "en", g: ["Drama"], v: 20 },
  { id: "netflix:3", t: "Heist Academy", y: 2022, k: "series", rt: 30,
    s: "Students learn the art of the heist.",
    im: null, r: null, p: ["netflix"], u: { netflix: "https://x/3" }, img: null,
    l: "hi", g: ["Comedy"], v: 0 },
  { id: "netflix:4", t: "Quiet Town", y: 1999, k: "movie", rt: 200,
    s: "Nothing happens here.",
    im: null, r: 6.0, p: ["netflix"], u: { netflix: "https://x/4" }, img: null,
    l: "hi", g: ["Drama"], v: 5 }
];

const t = createTools({
  records: recs,
  index: buildIndex(recs),
  search,
  filterIndices,
  normalizeTitle,
  seenKeys: ["space heist"]
});

strictEqual(t.schemas.length, 4);
deepStrictEqual(t.schemas.map((s) => s.function.name),
  ["search_titles", "filter_titles", "get_titles", "sample_titles"]);
ok(t.schemas.every((s) => s.type === "function" && s.function.parameters.type === "object"));

const a = await t.handlers.search_titles({ query: "heist" });
strictEqual(a.count, 2);
deepStrictEqual(Object.keys(a.results[0]).sort(), ["g", "id", "k", "l", "p", "r", "rt", "s", "t", "y"]);

const b = await t.handlers.search_titles({ query: "heist", exclude_seen: true });
strictEqual(b.count, 1);
strictEqual(b.results[0].id, "netflix:3");

const c = await t.handlers.filter_titles({ type: "series", sort: "rating" });
strictEqual(c.count, 2);
strictEqual(c.results[0].id, "netflix:2");

const d = await t.handlers.get_titles({ ids: ["netflix:2", "nope:9"] });
strictEqual(d.count, 1);
ok("u" in d.results[0]);
ok("img" in d.results[0]);

const dFiltered = await t.handlers.get_titles({
  ids: ["netflix:1", "netflix:3"],
  language: "hi",
  genre: "Comedy"
});
strictEqual(dFiltered.count, 1);
strictEqual(dFiltered.results[0].id, "netflix:3");

const e = await t.handlers.sample_titles({ n: 2, seed: 42 });
strictEqual(e.count, 2);

const f = await t.handlers.sample_titles({ n: 2, seed: 42 });
deepStrictEqual(e.results.map((x) => x.id), f.results.map((x) => x.id));

const g = await t.handlers.search_titles({ query: "heist", limit: 999 });
ok(g.count <= 50);

console.log("check_tools OK");
