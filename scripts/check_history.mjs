import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { parseNetflixCsv, summarize } from "../docs/js/history.js";

const csv = readFileSync(new URL("../data/fixtures/netflix_history_sample.csv", import.meta.url), "utf8");
const parsed = parseNetflixCsv(csv);

assert.equal(parsed.series.length, 4);
assert.equal(parsed.movies.length, 5);
assert.equal(parsed.seen.length, 16);
assert.equal(parsed.series[0].name, "The Ba***ds of Bollywood");
assert.equal(parsed.series[0].episodes, 3);
assert.equal(parsed.series.map((s) => s.name).includes("Seinfeld"), true);
assert.equal(parsed.series.find((s) => s.name === "Seinfeld").episodes, 2);
assert.equal(parsed.series.find((s) => s.name === "Seinfeld").lastWatched, "2026-02-12");
assert.deepEqual(parsed.movies.map((m) => m.title).sort(), [
  "Bulbbul",
  "Dhurandhar",
  "Gunday",
  "Ricky Gervais: Mortality",
  "Tokyo Trial: Episode 1"
]);
assert.equal(parsed.seen.includes("the ba ds of bollywood"), true);
assert.equal(parsed.seen.includes("seinfeld"), true);
assert.equal(typeof summarize(parsed), "string");
assert.ok(summarize(parsed).includes("4 series"));

const quoted = parseNetflixCsv("Title,Date\n\"A, B: Season 1: x\",\"1/2/26\"\n");
assert.equal(quoted.series[0].name, "A, B");

console.log("check_history OK");
