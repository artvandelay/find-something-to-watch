import assert from "node:assert/strict";
import { EXECUTION_LIMITS, executeCatalogCode, prepareExecutionEnvironment } from "../docs/js/catalog-execution.js";

const records = [
  {
    id: "tmdb:m1", t: "Bright Mystery", y: 2022, k: "movie", rt: 100, s: "A bright detective mystery.",
    im: null, r: 8.5, p: ["netflix"],
    l: "en", g: ["Mystery"], v: 100
  },
  {
    id: "tmdb:t2", t: "Quiet Comedy", y: 2020, k: "series", rt: 30, s: "A gentle funny family comedy.",
    im: null, r: 7.5, p: ["prime"],
    l: "hi", g: ["Comedy"], v: 20
  },
  {
    id: "tmdb:m3", t: "Old Drama", y: 2010, k: "movie", rt: 120, s: "A classic family drama.",
    im: null, r: 6.5, p: ["netflix", "prime"],
    l: "en", g: ["Drama"], v: 1
  }
];

const environment = prepareExecutionEnvironment(JSON.stringify({
  records,
  meta: { region: "IN" },
  fields: ["id", "t"],
  sample: ["tmdb:t2", "tmdb:m1"],
  context: { subscriptions: ["netflix"] }
}));

assert.equal(Object.isFrozen(environment.catalog.records), true);
assert.equal(Object.isFrozen(environment.catalog.records[0]), true);
assert.equal("u" in environment.catalog.records[0], false);
assert.equal("img" in environment.catalog.records[0], false);

const direct = await executeCatalogCode(
  "return catalog.records.filter((record) => record.k === 'movie');",
  environment
);
assert.deepEqual(JSON.parse(direct.json).map((record) => record.id), ["tmdb:m1", "tmdb:m3"]);
assert.deepEqual(direct.observedIds, ["tmdb:m1", "tmdb:m3"]);
assert.equal(direct.count, 2);

const helperResult = await executeCatalogCode(
  `const filtered = helpers.where({ minRating: 7.5 }).map((record) => record.id);
   const ordered = helpers.get(["tmdb:t2", "tmdb:m1"]).map((record) => record.id);
   const searched = helpers.search("detective", { limit: 2 }).map((record) => record.id);
   const sampled = helpers.sample(1).map((record) => record.id);
   return { ids: filtered, ordered, searched, sampled, normalized: helpers.normalizeTitle("Brïght! Mystery") };`,
  environment
);
assert.deepEqual(JSON.parse(helperResult.json), {
  ids: ["tmdb:m1", "tmdb:t2"],
  ordered: ["tmdb:t2", "tmdb:m1"],
  searched: ["tmdb:m1"],
  sampled: ["tmdb:t2"],
  normalized: "bright mystery"
});
assert.deepEqual(helperResult.observedIds, ["tmdb:m1", "tmdb:t2"]);

await assert.rejects(
  executeCatalogCode("catalog.records[0].t = 'changed'; return null;", environment),
  { code: "EXECUTION_ERROR" }
);
await assert.rejects(executeCatalogCode(" ", environment), { code: "INVALID_CODE" });
await assert.rejects(
  executeCatalogCode("return import /*comment*/ ('x');", environment),
  { code: "FORBIDDEN_CAPABILITY" }
);
await assert.rejects(
  executeCatalogCode(`return "${"x".repeat(EXECUTION_LIMITS.maxStringCharacters + 1)}";`, environment),
  { code: "OUTPUT_LIMIT" }
);
await assert.rejects(
  executeCatalogCode(`return Array(${EXECUTION_LIMITS.maxArrayItems + 1}).fill(null);`, environment),
  { code: "OUTPUT_LIMIT" }
);
await assert.rejects(
  executeCatalogCode("const value = {}; value.self = value; return value;", environment),
  { code: "INVALID_OUTPUT" }
);
await assert.rejects(executeCatalogCode("return { value: Infinity };", environment), { code: "INVALID_OUTPUT" });
await assert.rejects(
  executeCatalogCode(
    "const value = {}; Object.defineProperty(value, 'result', { enumerable: true, get() { return 1; } }); return value;",
    environment
  ),
  { code: "INVALID_OUTPUT" }
);
await assert.rejects(
  executeCatalogCode(`return Array(33).fill("${"x".repeat(EXECUTION_LIMITS.maxStringCharacters)}");`, environment),
  { code: "OUTPUT_LIMIT" }
);

const scopedIds = await executeCatalogCode(
  "return { note: 'tmdb:m3', ids: ['tmdb:t2'], record: catalog.records[0] };",
  environment
);
assert.deepEqual(scopedIds.observedIds, ["tmdb:t2", "tmdb:m1"]);

console.log("catalog execution checks passed");
