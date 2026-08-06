export const RECOMMENDATION_SCHEMA_VERSION = 3;
export const DEFAULT_RECOMMENDATION_REASON = "Selected from your catalog for this request.";
export const RECOMMENDATION_LIMITS = Object.freeze({
  items: 20,
  reasonCharacters: 180,
  sourceQueryCharacters: 120
});

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function collapseWhitespace(value, max = Infinity) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function safeId(value) {
  const id = collapseWhitespace(value, 240);
  return id && !/^https?:\/\//i.test(id) ? id : "";
}

function safeReason(value) {
  const reason = collapseWhitespace(value, RECOMMENDATION_LIMITS.reasonCharacters);
  return reason || DEFAULT_RECOMMENDATION_REASON;
}

function safeSource(value) {
  if (!isObject(value)) return null;
  const conversationId = safeId(value.conversationId);
  const turnId = safeId(value.turnId);
  const query = collapseWhitespace(value.query, RECOMMENDATION_LIMITS.sourceQueryCharacters);
  if (!conversationId || !turnId || !query) return null;
  return { conversationId, turnId, query };
}

export function defaultRecommendationQueue() {
  return {
    schema: RECOMMENDATION_SCHEMA_VERSION,
    updatedAt: null,
    source: null,
    items: []
  };
}

/**
 * Accepts schema-2 `{ ids }` queues for migration, but emits only the bounded
 * schema-3 decision record. Item order is rank and never gets sorted.
 */
export function sanitizeRecommendationQueue(value, { updatedAt = null } = {}) {
  if (!isObject(value)) return null;
  const rawItems = Array.isArray(value.items)
    ? value.items
    : Array.isArray(value.ids) ? value.ids.map((id) => ({ id })) : null;
  if (!rawItems) return null;

  const ids = new Set();
  const items = [];
  for (const raw of rawItems) {
    const id = safeId(typeof raw === "string" ? raw : raw?.id);
    if (!id || ids.has(id)) continue;
    ids.add(id);
    items.push({ id, reason: safeReason(typeof raw === "string" ? "" : raw?.reason) });
    if (items.length === RECOMMENDATION_LIMITS.items) break;
  }

  return {
    schema: RECOMMENDATION_SCHEMA_VERSION,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : updatedAt,
    source: safeSource(value.source),
    items
  };
}

export function recommendationQueuesEqual(left, right) {
  const a = sanitizeRecommendationQueue(left);
  const b = sanitizeRecommendationQueue(right);
  if (!a || !b || a.source?.conversationId !== b.source?.conversationId ||
    a.source?.turnId !== b.source?.turnId || a.source?.query !== b.source?.query ||
    a.items.length !== b.items.length) return false;
  return a.items.every((item, index) => item.id === b.items[index].id && item.reason === b.items[index].reason);
}

export function hydrateRecommendations(queue, resolveTitle) {
  const safeQueue = sanitizeRecommendationQueue(queue);
  if (!safeQueue || typeof resolveTitle !== "function") return [];
  return safeQueue.items.map((item) => {
    const title = resolveTitle(item.id);
    return title ? { ...title, reason: item.reason } : null;
  }).filter(Boolean);
}

export function recommendationSourceLabel(queue) {
  const safeQueue = sanitizeRecommendationQueue(queue);
  return safeQueue?.source?.query ? `For “${safeQueue.source.query}”` : "";
}

/** True when a reason is worth showing — not empty and not the catalog filler fallback. */
export function isUsefulReason(reason) {
  const text = collapseWhitespace(reason, RECOMMENDATION_LIMITS.reasonCharacters);
  return Boolean(text) && text !== DEFAULT_RECOMMENDATION_REASON;
}

/** Detect an explicit rewatch ask so watched titles may stay in the decision. */
export function allowsRewatch(query) {
  const text = String(query || "").toLowerCase();
  return /\brewatch\b/.test(text)
    || /\bwatch(?:ing)? again\b/.test(text)
    || /\bseen (?:it|this|them) again\b/.test(text)
    || /\balready watched\b/.test(text) && /\bagain\b/.test(text);
}
