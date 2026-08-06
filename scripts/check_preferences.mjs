import assert from "node:assert/strict";
import {
  defaultLearnedPreferences,
  mergeLearnedPreferences,
  renderLearnedContext,
  sanitizeLearnedPreferences,
  upsertLearnedPreference,
  validatePreferenceCandidate,
  validatePreferenceCandidates
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

console.log("check_preferences OK");
