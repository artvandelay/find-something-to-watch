import assert from "node:assert/strict";
import {
  ENRICH_PACE,
  ENRICH_TONE,
  ENRICH_FIT,
  computeEnrichmentSignature,
  needsEnrichment,
  heuristicTagsForRecord,
  enrichLocalSignals,
  validateEnrichmentPayload,
  runEnricher
} from "../docs/js/enricher.js";

// Check enums
assert.deepEqual(Array.from(ENRICH_PACE), ["slow", "medium", "fast"]);
assert.deepEqual(Array.from(ENRICH_TONE), ["bleak", "warm", "tense", "playful", "cerebral", "gritty"]);
assert.deepEqual(Array.from(ENRICH_FIT), ["solo", "family", "late-night", "weekend", "background"]);

// Check needsEnrichment on empty history
assert.equal(needsEnrichment({ history: null }), false);
assert.equal(needsEnrichment({ history: { seen: [], movies: [], series: [] } }), false);

// Check needsEnrichment with un-enriched history
const sampleHistory = {
  seen: ["bulbbul", "dhurandhar", "seinfeld"],
  movies: [
    { title: "Bulbbul" },
    { title: "Dhurandhar" },
    { title: "Short Film" }
  ],
  series: [
    { name: "Seinfeld", episodes: 2 }
  ]
};
assert.equal(needsEnrichment({ history: sampleHistory }), true);

// Check heuristic tags
const horrorRec = { id: "tmdb:m1", t: "Bulbbul", rt: 92, g: ["Horror", "Drama"], k: "movie" };
const horrorTags = heuristicTagsForRecord(horrorRec);
assert.equal(horrorTags.pace, "fast");
assert.equal(horrorTags.tone, "bleak");
assert.equal(horrorTags.fit, "late-night");

const longFamilyRec = { id: "tmdb:m2", t: "Family Movie", rt: 145, g: ["Family", "Animation"], k: "movie" };
const familyTags = heuristicTagsForRecord(longFamilyRec);
assert.equal(familyTags.pace, "slow");
assert.equal(familyTags.tone, "warm");
assert.equal(familyTags.fit, "family");

// Check enrichLocalSignals
const sampleRecords = [
  { id: "tmdb:m1", t: "Bulbbul", rt: 92, g: ["Horror"], k: "movie", v: 100 },
  { id: "tmdb:m2", t: "Dhurandhar", rt: 90, g: ["Horror", "Thriller"], k: "movie", v: 200 },
  { id: "tmdb:m3", t: "Short Film", rt: 85, g: ["Horror", "Short"], k: "movie", v: 50 },
  { id: "tmdb:s1", t: "Seinfeld", rt: 22, g: ["Comedy"], k: "series", v: 500 }
];

const localResult = enrichLocalSignals({
  history: sampleHistory,
  learned: null,
  records: sampleRecords,
  now: () => new Date("2026-08-05T00:00:00.000Z")
});

assert.equal(localResult.resolvedCount, 4);
assert.equal(localResult.taggedCount, 4);
assert.equal(localResult.history.resolvedIds.length, 4);
assert.equal(localResult.history.titleTags["tmdb:m1"].tone, "bleak");

// Check statistical preferences: Horror is in 3 of 4 titles (75% >= 50%), and 3 movies have rt <= 100 (100% >= 60%)
const horrorPref = localResult.learned.items.find((it) => it.kind === "genre" && it.value === "Horror");
assert.ok(horrorPref, "Should infer Horror genre like");
assert.equal(horrorPref.polarity, "like");

const habitPref = localResult.learned.items.find((it) => it.kind === "habit");
assert.ok(habitPref, "Should infer habit for short movies");
assert.equal(habitPref.value, "movies under 100 minutes");

// Check validateEnrichmentPayload
const allowed = new Set(["tmdb:m1", "tmdb:m2"]);
const rawPayload = JSON.stringify({
  titleTags: {
    "tmdb:m1": { pace: "slow", tone: "bleak", fit: "late-night", extra: "discard" },
    "tmdb:m2": { pace: "invalid", tone: "tense", fit: "weekend" },
    "unknown:999": { pace: "fast", tone: "warm", fit: "solo" }
  },
  preferences: [
    {
      kind: "theme",
      polarity: "avoid",
      value: "Bleak folk horror",
      subjectId: "tmdb:m1",
      subjectTitle: "Bulbbul",
      reason: "Too dark"
    },
    {
      kind: "invalid-kind",
      polarity: "like",
      value: "test"
    },
    {
      kind: "genre",
      polarity: "invalid-pol",
      value: "Horror"
    }
  ]
});

const validated = validateEnrichmentPayload(rawPayload, allowed);
assert.deepEqual(validated.titleTags["tmdb:m1"], { pace: "slow", tone: "bleak", fit: "late-night" });
assert.deepEqual(validated.titleTags["tmdb:m2"], { tone: "tense", fit: "weekend" });
assert.equal(validated.titleTags["unknown:999"], undefined);
assert.equal(validated.preferences.length, 1);
assert.equal(validated.preferences[0].value, "Bleak folk horror");
assert.equal(validated.preferences[0].subjectId, "tmdb:m1");

// Also test markdown-fenced string and malformed JSON
const fenced = "```json\n" + rawPayload + "\n```";
const validatedFenced = validateEnrichmentPayload(fenced, allowed);
assert.deepEqual(validatedFenced.titleTags["tmdb:m1"], { pace: "slow", tone: "bleak", fit: "late-night" });

const malformed = validateEnrichmentPayload("{ invalid json", allowed);
assert.deepEqual(malformed, { titleTags: {}, preferences: [] });

// Check runEnricher with simulated LLM completion
let callCount = 0;
const mockCallImpl = async (config, body, { fetchImpl, signal } = {}) => {
  callCount++;
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            titleTags: {
              "tmdb:m1": { pace: "slow", tone: "bleak", fit: "late-night" }
            },
            preferences: [
              {
                kind: "theme",
                polarity: "avoid",
                value: "Slow burn",
                subjectId: "tmdb:m1",
                subjectTitle: "Bulbbul",
                reason: "Too slow"
              }
            ]
          })
        }
      }
    ]
  };
};

const enriched = await runEnricher({
  config: { apiKey: "test-key" },
  history: sampleHistory,
  learned: null,
  records: sampleRecords,
  callImpl: mockCallImpl,
  now: () => new Date("2026-08-05T00:00:00.000Z")
});

assert.equal(callCount, 1);
assert.equal(enriched.usedModel, true);
assert.equal(enriched.history.titleTags["tmdb:m1"].pace, "slow");
assert.ok(enriched.history.enrichedAt);
assert.ok(enriched.history.enrichedSignature);
// needsEnrichment should now be false!
assert.equal(needsEnrichment({ history: enriched.history }), false);

// Check runEnricher graceful degradation on network error
const failingCallImpl = async () => {
  const err = new Error("Network offline");
  err.code = "network";
  throw err;
};

const degraded = await runEnricher({
  config: { apiKey: "test-key" },
  history: sampleHistory,
  learned: null,
  records: sampleRecords,
  callImpl: failingCallImpl,
  now: () => new Date("2026-08-05T00:00:00.000Z")
});

assert.equal(degraded.usedModel, false);
assert.equal(degraded.resolvedCount, 4);
assert.ok(degraded.history.enrichedSignature);
assert.equal(needsEnrichment({ history: degraded.history }), false);

console.log("check_enricher OK");
