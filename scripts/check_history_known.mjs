import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { strToU8, zipSync } from "fflate";
import { detectKnownExport, inspectWatchHistoryFiles, parseWatchHistoryExport } from "../docs/js/history.js";

const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
globalThis.DOMParser = dom.window.DOMParser;

const jsonText = await readFile(new URL("../data/fixtures/youtube-watch-history.fixture.json", import.meta.url), "utf8");
const htmlText = await readFile(new URL("../data/fixtures/youtube-watch-history.fixture.html", import.meta.url), "utf8");
const netflixCsv = [
  "Title,Date",
  "The Night Of,1/2/24",
  "Mindhunter: Season 1: Episode 1,1/3/24"
].join("\n");

function known(input) {
  return detectKnownExport(inspectWatchHistoryFiles(input));
}

const kept = [
  "a star is born",
  "charade",
  "his girl friday",
  "metropolis",
  "night of the living dead",
  "nosferatu",
  "the general"
];

function assertYouTube(parsed, format) {
  assert.equal(parsed.sources.length, 1);
  assert.equal(parsed.sources[0].kind, "youtube");
  assert.equal(parsed.sources[0].format, format);
  assert.equal(parsed.sources[0].records, 7);
  assert.deepEqual(parsed.seen, kept);
  const star = parsed.other.find((item) => item.title === "A Star is Born");
  assert.equal(star.channel, "Open Culture");
  assert.equal(parsed.other.some((item) => /Sponsored|removed|Missing link/i.test(item.title)), false);
}

const fromJson = known({ name: "watch-history.json", text: jsonText });
assertYouTube(fromJson, "json");
assert.equal(fromJson.other.find((item) => item.title === "A Star is Born").lastWatched, "2024-02-01T18:00:00.000Z");

const fromHtml = known({ name: "watch-history.html", text: htmlText });
assertYouTube(fromHtml, "html");

const zipped = zipSync({
  "Takeout/YouTube and YouTube Music/history/watch-history.html": strToU8(htmlText)
});
const fromZip = known({ name: "takeout.zip", bytes: zipped });
assertYouTube(fromZip, "html");
assert.match(fromZip.sources[0].name, /watch-history\.html$/);

const fromNetflix = known({ name: "ViewingActivity.csv", text: netflixCsv });
assert.equal(fromNetflix.sources[0].kind, "netflix");
assert.ok(fromNetflix.seen.includes("the night of"));
assert.ok(fromNetflix.series.some((item) => item.name === "Mindhunter"));

let netflixInferred = false;
const viaAgent = await parseWatchHistoryExport(
  { name: "ViewingActivity.csv", text: netflixCsv },
  {
    inferPlan: async (input) => {
      netflixInferred = true;
      assert.equal(input.files[0].name, "ViewingActivity.csv");
      assert.equal(JSON.stringify(input).includes(netflixCsv), false);
      return {
        schema: 1,
        files: [{
          name: "ViewingActivity.csv",
          format: "csv",
          headerRow: 0,
          dataStartRow: 1,
          titleColumn: 0,
          dateColumn: 1,
          typeColumn: null,
          seriesColumn: null,
          episodeColumn: null,
          dateFormat: "mdy",
          typeMap: { movie: [], series: [] }
        }]
      };
    }
  }
);
assert.equal(netflixInferred, true);
assert.ok(viaAgent.seen.includes("mindhunter"));
assert.equal(viaAgent.sources[0].kind, undefined);

let inferred = false;
const other = await parseWatchHistoryExport(
  { name: "custom.csv", text: "Name,When\nOther Film,2024-01-02\n" },
  {
    inferPlan: async () => {
      inferred = true;
      return {
        schema: 1,
        files: [{
          name: "custom.csv",
          format: "csv",
          headerRow: 0,
          dataStartRow: 1,
          titleColumn: 0,
          dateColumn: 1,
          typeColumn: null,
          seriesColumn: null,
          episodeColumn: null,
          dateFormat: "iso",
          typeMap: { movie: [], series: [] }
        }]
      };
    }
  }
);
assert.equal(inferred, true);
assert.ok(other.seen.includes("other film"));
assert.equal(other.sources[0].kind, undefined);

console.log("check_history_known: ok");
