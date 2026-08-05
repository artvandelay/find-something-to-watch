import assert from "node:assert/strict";
import {
  DEFAULT_RECOMMENDATION_REASON,
  defaultRecommendationQueue,
  hydrateRecommendations,
  recommendationQueuesEqual,
  recommendationSourceLabel,
  sanitizeRecommendationQueue
} from "../docs/js/recommendations.js";

assert.deepEqual(defaultRecommendationQueue().items, []);
const migrated = sanitizeRecommendationQueue({
  schema: 2,
  ids: ["tmdb:one", "tmdb:one", "https://unsafe.example/", "tmdb:two"]
});
assert.deepEqual(migrated.items, [
  { id: "tmdb:one", reason: DEFAULT_RECOMMENDATION_REASON },
  { id: "tmdb:two", reason: DEFAULT_RECOMMENDATION_REASON }
]);
assert.equal(migrated.source, null);

const queue = sanitizeRecommendationQueue({
  source: { conversationId: "chat-1", turnId: "turn-1", query: "  short\n no horror  " },
  items: [
    { id: "tmdb:one", reason: "  It is concise. " },
    { id: "tmdb:one", reason: "duplicate" },
    { id: "tmdb:two", reason: "" }
  ]
});
assert.deepEqual(queue.source, { conversationId: "chat-1", turnId: "turn-1", query: "short no horror" });
assert.equal(queue.items[0].reason, "It is concise.");
assert.equal(queue.items[1].reason, DEFAULT_RECOMMENDATION_REASON);
assert.equal(recommendationSourceLabel(queue), "For “short no horror”");
assert.equal(recommendationQueuesEqual(queue, { ...queue, updatedAt: "later" }), true);
assert.deepEqual(
  hydrateRecommendations(queue, (id) => id === "tmdb:one" ? { id, t: "One" } : null),
  [{ id: "tmdb:one", t: "One", reason: "It is concise." }]
);
assert.equal(sanitizeRecommendationQueue(null), null);

console.log("check_recommendations OK");
