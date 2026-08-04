import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { zipSync, strToU8 } from "../docs/js/vendor/fflate.js";
import {
  HISTORY_IMPORT_LIMITS,
  HistoryImportError,
  applyHistoryPlan,
  buildHistoryInferenceInput,
  inspectWatchHistoryFiles,
  parseNetflixCsv,
  parseWatchHistoryExport,
  summarize,
  validateHistoryPlan
} from "../docs/js/history.js";
import { createHistoryPlanInferer } from "../docs/js/history-model.js";

const NOW = () => new Date("2026-08-05T00:00:00.000Z");
const csv = [
  "Title,Watched,Kind,Show",
  "Pilot,12/02/2026,episode,Example Show",
  "A Film,13/02/2026,movie,",
  "Unknown,31/02/2026,other,"
].join("\n");
const json = JSON.stringify({
  payload: {
    viewing: [
      { name: "Nested Film", watchedAt: "2026-02-14T10:00:00Z", media: "film" },
      { name: "Nested Series", watchedAt: "14/02/2026", media: "episode", show: "Nested Show" }
    ]
  }
});

function csvPlan(name = "watch.csv") {
  return {
    name,
    format: "csv",
    headerRow: 0,
    dataStartRow: 1,
    titleColumn: 0,
    dateColumn: 1,
    typeColumn: 2,
    seriesColumn: 3,
    episodeColumn: null,
    dateFormat: "dmy",
    typeMap: { movie: ["movie", "film"], series: ["episode", "series"] }
  };
}

function jsonPlan(name = "history.json") {
  return {
    name,
    format: "json",
    recordsPath: ["payload", "viewing"],
    titlePath: ["name"],
    datePath: ["watchedAt"],
    typePath: ["media"],
    seriesPath: ["show"],
    episodePath: null,
    dateFormat: "iso",
    typeMap: { movie: ["movie", "film"], series: ["episode", "series"] }
  };
}

const csvFiles = inspectWatchHistoryFiles({ name: "watch.csv", text: csv });
const csvHistory = applyHistoryPlan({ schema: 1, files: [csvPlan()] }, csvFiles, { now: NOW });
assert.equal(csvHistory.schema, 2);
assert.equal(csvHistory.series[0].name, "Example Show");
assert.equal(csvHistory.series[0].lastWatched, "2026-02-12");
assert.equal(csvHistory.movies[0].lastWatched, "2026-02-13");
assert.equal(csvHistory.other[0].lastWatched, null);

const jsonFiles = inspectWatchHistoryFiles({ name: "history.json", text: json });
const jsonHistory = applyHistoryPlan({ schema: 1, files: [jsonPlan()] }, jsonFiles, { now: NOW });
assert.equal(jsonHistory.movies[0].title, "Nested Film");
assert.equal(jsonHistory.movies[0].lastWatched, "2026-02-14");
assert.equal(jsonHistory.series[0].name, "Nested Show");
assert.equal(jsonHistory.series[0].lastWatched, null);

const archive = zipSync({
  "watch.csv": strToU8(csv),
  "history.json": strToU8(json)
});
const archiveFiles = inspectWatchHistoryFiles({ name: "exports.zip", data: archive });
assert.equal(archiveFiles.length, 2);
const archiveHistory = applyHistoryPlan({
  schema: 1,
  files: [csvPlan(), jsonPlan()]
}, archiveFiles, { now: NOW });
assert.equal(archiveHistory.sources.length, 2);
assert.equal(archiveHistory.seen.includes("nested show"), true);

assert.throws(() => inspectWatchHistoryFiles({ name: "bad.csv", text: "Title\n\"unterminated" }), HistoryImportError);
assert.throws(() => inspectWatchHistoryFiles({ name: "bad.json", text: "{]" }), HistoryImportError);
assert.throws(() => inspectWatchHistoryFiles({ name: "bad.zip", data: new Uint8Array([1, 2, 3]) }), HistoryImportError);
assert.throws(() => inspectWatchHistoryFiles({
  name: "bomb.zip",
  data: zipSync({ "large.csv": strToU8("Title\n" + "x".repeat(100)) })
}, { limits: { ...HISTORY_IMPORT_LIMITS, candidateFileBytes: 20 } }), HistoryImportError);

assert.throws(() => validateHistoryPlan({
  schema: 1,
  files: [{ ...csvPlan(), titleColumn: 99 }]
}, csvFiles), HistoryImportError);
assert.throws(() => validateHistoryPlan({
  schema: 1,
  files: [{ ...jsonPlan(), titlePath: ["__proto__"] }]
}, jsonFiles), HistoryImportError);

const firstInput = buildHistoryInferenceInput(archiveFiles);
const secondInput = buildHistoryInferenceInput(archiveFiles);
assert.deepEqual(firstInput, secondInput);
assert.ok(JSON.stringify(firstInput).length <= HISTORY_IMPORT_LIMITS.inferenceInputCharacters);

const controller = new AbortController();
controller.abort();
await assert.rejects(
  parseWatchHistoryExport({ name: "watch.csv", text: csv }, {
    inferPlan: async () => ({ schema: 1, files: [csvPlan()] }),
    signal: controller.signal
  }),
  (error) => error.name === "AbortError"
);

let sentBody = "";
const inferPlan = createHistoryPlanInferer({
  config: { baseUrl: "https://example.test/v1", apiKey: "test", model: "test-model" },
  prompt: "Return JSON only.",
  fetchImpl: async (_url, request) => {
    sentBody = request.body;
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ schema: 1, files: [csvPlan()] }) } }]
      })
    };
  }
});
const parsed = await parseWatchHistoryExport({ name: "watch.csv", text: csv }, { inferPlan, now: NOW });
assert.equal(parsed.movies.length, 1);
assert.ok(sentBody.length < csv.length + 1000);
assert.equal(sentBody.includes("Pilot"), true);
assert.equal(sentBody.includes("x".repeat(100)), false);

const legacy = parseNetflixCsv("Title,Date\n\"A, B: Season 1: x\",\"1/2/26\"\n");
assert.equal(legacy.series[0].name, "A, B");
assert.equal(typeof summarize(legacy), "string");

const netflixCsv = readFileSync(
  new URL("../data/fixtures/netflix_history_sample.csv", import.meta.url),
  "utf8"
);
const netflix = parseNetflixCsv(netflixCsv);
assert.equal(netflix.series.length, 4);
assert.equal(netflix.movies.length, 5);
assert.equal(netflix.seen.length, 16);
assert.equal(netflix.series[0].name, "The Ba***ds of Bollywood");
assert.equal(netflix.series[0].episodes, 3);
assert.equal(netflix.series.find((series) => series.name === "Seinfeld").episodes, 2);
assert.equal(netflix.series.find((series) => series.name === "Seinfeld").lastWatched, "2026-02-12");
assert.deepEqual(netflix.movies.map((movie) => movie.title).sort(), [
  "Bulbbul",
  "Dhurandhar",
  "Gunday",
  "Ricky Gervais: Mortality",
  "Tokyo Trial: Episode 1"
]);
assert.equal(netflix.seen.includes("the ba ds of bollywood"), true);
assert.equal(netflix.seen.includes("seinfeld"), true);

console.log("check_history OK");
