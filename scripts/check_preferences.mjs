import assert from "node:assert/strict";
import {
  defaultLearnedPreferences,
  mergeLearnedPreferences,
  renderLearnedContext,
  sanitizeLearnedPreferences,
  upsertLearnedPreference,
  validatePreferenceCandidate,
  validatePreferenceCandidates,
  validateWatchedCandidates
} from "../docs/js/preferences.js";

const now = "2026-08-05T00:00:00.000Z";
assert.deepEqual(defaultLearnedPreferences().items, []);
assert.deepEqual(
  validatePreferenceCandidate(
    { kind: "genre", polarity: "avoid", value: "horror", explicit: true, durable: true, evidence: "HORROR" },
    "I always avoid horror films."
  ),
  { kind: "genre", polarity: "avoid", value: "horror" }
);
for (const candidate of [
  { kind: "genre", polarity: "like", value: "comedy", durable: true, evidence: "comedy" },
  { kind: "genre", polarity: "like", value: "comedy", explicit: false, durable: true, evidence: "comedy" },
  { kind: "genre", polarity: "like", value: "comedy", explicit: true, evidence: "comedy" },
  { kind: "genre", polarity: "like", value: "comedy", explicit: true, durable: false, evidence: "comedy" },
  { kind: "genre", polarity: "like", value: "comedy", explicit: true, durable: true },
  { kind: "genre", polarity: "like", value: "comedy", explicit: true, durable: true, evidence: "sitcoms" }
]) {
  assert.equal(validatePreferenceCandidate(candidate, "I always like comedy."), null);
}
assert.equal(validatePreferenceCandidates([
  { kind: "genre", polarity: "like", value: "comedy", explicit: true, durable: true, evidence: "comedy" },
  { kind: "genre", polarity: "avoid", value: "horror", explicit: true, durable: true, evidence: "horror" }
], "I love comedy and avoid horror.").length, 2);
assert.deepEqual(validatePreferenceCandidates([], "Horror recommendations, please."), []);

const initial = mergeLearnedPreferences(
  defaultLearnedPreferences(),
  [{ kind: "genre", polarity: "avoid", value: "horror", explicit: true, durable: true, evidence: "horror" }],
  "I always avoid horror.",
  { now }
);
assert.equal(initial.items.length, 1);
const contradicted = mergeLearnedPreferences(
  initial,
  [{ kind: "genre", polarity: "like", value: "horror", explicit: true, durable: true, evidence: "horror" }],
  "I now like horror.",
  { now: "2026-08-06T00:00:00.000Z" }
);
assert.equal(contradicted.items.length, 1);
assert.equal(contradicted.items[0].polarity, "like");
assert.match(renderLearnedContext(contradicted), /## Learned from chats\n- Likes: horror \(genre\)/);
assert.equal(sanitizeLearnedPreferences({ items: [{ kind: "bad", polarity: "like", value: "x" }] }, { now }).items.length, 0);

const fromFeedback = upsertLearnedPreference(
  defaultLearnedPreferences(),
  { kind: "genre", polarity: "like", value: "thriller" },
  { now }
);
assert.equal(fromFeedback.items.length, 1);
assert.equal(fromFeedback.items[0].value, "thriller");
assert.equal(fromFeedback.revision, 1);
assert.equal(
  upsertLearnedPreference(fromFeedback, { kind: "genre", polarity: "like", value: "thriller" }, { now }).revision,
  1
);
assert.equal(upsertLearnedPreference(fromFeedback, { kind: "nope", polarity: "like", value: "x" }, { now }).items.length, 1);

const habit = mergeLearnedPreferences(
  defaultLearnedPreferences(),
  [{ kind: "habit", polarity: "like", value: "weeknights under 90m", explicit: true, durable: true, evidence: "weeknights under 90m" }],
  "I only watch on weeknights under 90m",
  { now }
);
assert.equal(habit.items[0].kind, "habit");
assert.match(renderLearnedContext(habit), /- Likes: weeknights under 90m \(habit\)/);

const packed = {
  schema: 1,
  revision: 0,
  items: Array.from({ length: 100 }, (_, index) => ({
    id: "id-" + index,
    kind: "genre",
    polarity: "like",
    value: "value " + index,
    createdAt: now,
    lastConfirmedAt: new Date(Date.parse(now) + index * 1000).toISOString()
  }))
};
const confirmed = mergeLearnedPreferences(
  packed,
  [{ kind: "genre", polarity: "like", value: "value 0", explicit: true, durable: true, evidence: "value 0" }],
  "I still like value 0",
  { now: "2026-09-01T00:00:00.000Z" }
);
assert.equal(confirmed.items[0].lastConfirmedAt, "2026-09-01T00:00:00.000Z");
const evicted = mergeLearnedPreferences(
  confirmed,
  [{ kind: "habit", polarity: "like", value: "sunday films", explicit: true, durable: true, evidence: "sunday films" }],
  "I like sunday films",
  { now: "2026-09-02T00:00:00.000Z" }
);
assert.equal(evicted.items.length, 100);
assert.equal(evicted.items.some((item) => item.value === "value 0"), true);
assert.equal(evicted.items.some((item) => item.value === "value 1"), false);
assert.equal(evicted.items.some((item) => item.value === "sunday films"), true);

assert.deepEqual(
  validateWatchedCandidates(
    [
      { title: "Dark Matter", evidence: "watched Dark Matter" },
      { title: "Hallucinated", evidence: "not in query" },
      { title: "dark matter", evidence: "Dark Matter" }
    ],
    "I watched Dark Matter last week"
  ),
  ["Dark Matter"]
);
assert.equal(validateWatchedCandidates(
  Array.from({ length: 10 }, (_, index) => ({ title: "Title " + index, evidence: "watched" })),
  "I watched several"
).length, 8);

const tripleFact = upsertLearnedPreference(
  defaultLearnedPreferences(),
  {
    kind: "theme",
    polarity: "avoid",
    value: "Slow Burn",
    subjectId: "tmdb:m999",
    subjectTitle: "Slow Burn",
    reason: "Too bleak for weeknights"
  },
  { now }
);
assert.equal(tripleFact.items.length, 1);
assert.equal(tripleFact.items[0].subjectId, "tmdb:m999");
assert.equal(tripleFact.items[0].subjectTitle, "Slow Burn");
assert.equal(tripleFact.items[0].reason, "Too bleak for weeknights");
assert.equal(
  renderLearnedContext(tripleFact),
  "## Learned from chats\n- Avoid: Slow Burn (theme; from Slow Burn — Too bleak for weeknights)"
);

const rejectUrlFact = upsertLearnedPreference(
  defaultLearnedPreferences(),
  {
    kind: "theme",
    polarity: "avoid",
    value: "Slow Burn",
    subjectId: "https://example.com/movie/999",
    subjectTitle: "Slow Burn"
  },
  { now }
);
assert.equal(rejectUrlFact.items[0].subjectId, undefined);

const unanchored = upsertLearnedPreference(
  defaultLearnedPreferences(),
  { kind: "genre", polarity: "like", value: "horror" },
  { now }
);
assert.equal(
  renderLearnedContext(unanchored),
  "## Learned from chats\n- Likes: horror (genre)"
);

console.log("check_preferences OK");
