import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { buildIndex, filterIndices, normalizeTitle, search, tokenize } from "../docs/js/catalog.js";

const recs = [
  { id:"netflix:1", t:"Space Heist", y:2020, k:"movie", rt:100,
    s:"A crew of thieves plan a daring heist aboard a space station.",
    im:null, r:7.2, p:["netflix"], u:{netflix:"https://x/1"}, img:null },
  { id:"netflix:2", t:"Slow Burn", y:2015, k:"series", rt:45,
    s:"A quiet detective story about a small town and a long grudge.",
    im:null, r:8.1, p:["netflix"], u:{netflix:"https://x/2"}, img:null },
  { id:"netflix:3", t:"Heist Academy", y:2022, k:"series", rt:30,
    s:"Students learn the art of the heist.",
    im:null, r:null, p:["netflix"], u:{netflix:"https://x/3"}, img:null },
  { id:"netflix:4", t:"Quiet Town", y:1999, k:"movie", rt:200,
    s:"Nothing happens here.",
    im:null, r:6.0, p:["netflix"], u:{netflix:"https://x/4"}, img:null }
];

deepStrictEqual(tokenize("The Heist, aboard!"), ["heist", "aboard"]);
strictEqual(normalizeTitle("The Ba***ds of Bollywood"), "the ba ds of bollywood");

const idx = buildIndex(recs);
strictEqual(idx.N, 4);
ok(idx.avgLen > 0);

const hits = search(idx, "heist");
deepStrictEqual(hits.map((h) => recs[h.i].id).sort(), ["netflix:1", "netflix:3"]);

const one = search(idx, "heist", { allow: new Set([0]) });
strictEqual(one.length, 1);
strictEqual(one[0].i, 0);

deepStrictEqual(search(idx, "the and of"), []);

deepStrictEqual(filterIndices(recs, { k: "series" }), [1, 2]);
deepStrictEqual(filterIndices(recs, { runtimeMax: 60 }), [1, 2]);
deepStrictEqual(filterIndices(recs, { minRating: 7 }), [0, 1]);
deepStrictEqual(filterIndices(recs, { yearFrom: 2016 }), [0, 2]);
deepStrictEqual(filterIndices(recs, { excludeKeys: ["quiet town"] }), [0, 1, 2]);
deepStrictEqual(filterIndices(recs, {}), [0, 1, 2, 3]);

console.log("check_catalog OK");
