export const LEARNED_PREFERENCES_SCHEMA_VERSION = 1;
export const LEARNED_PREFERENCE_LIMITS = Object.freeze({
  items: 100,
  valueCharacters: 80,
  candidatesPerTurn: 8,
  contextCharacters: 4000
});

export const LEARNED_KINDS = Object.freeze([
  "genre", "language", "theme", "pace", "creator", "format", "content"
]);

const KIND_SET = new Set(LEARNED_KINDS);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function compact(value, max = Infinity) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function validIso(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function defaultId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "learned-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function defaultLearnedPreferences() {
  return { schema: LEARNED_PREFERENCES_SCHEMA_VERSION, updatedAt: null, revision: 0, items: [] };
}

export function sanitizeLearnedPreferences(value, { now = new Date().toISOString() } = {}) {
  if (!isObject(value)) return null;
  const seen = new Set();
  const items = [];
  for (const raw of Array.isArray(value.items) ? value.items : []) {
    const kind = typeof raw?.kind === "string" ? raw.kind : "";
    const polarity = raw?.polarity;
    const itemValue = compact(raw?.value, LEARNED_PREFERENCE_LIMITS.valueCharacters);
    const key = `${kind}\u0000${itemValue.toLocaleLowerCase()}`;
    if (!KIND_SET.has(kind) || (polarity !== "like" && polarity !== "avoid") || !itemValue || seen.has(key)) continue;
    seen.add(key);
    items.push({
      id: compact(raw?.id, 160) || defaultId(),
      kind,
      polarity,
      value: itemValue,
      createdAt: validIso(raw?.createdAt) ? raw.createdAt : now,
      lastConfirmedAt: validIso(raw?.lastConfirmedAt) ? raw.lastConfirmedAt : now
    });
    if (items.length === LEARNED_PREFERENCE_LIMITS.items) break;
  }
  return {
    schema: LEARNED_PREFERENCES_SCHEMA_VERSION,
    updatedAt: validIso(value.updatedAt) ? value.updatedAt : now,
    revision: Number.isInteger(value.revision) && value.revision >= 0 ? value.revision : 0,
    items
  };
}

/**
 * The candidate's evidence must be a literal substring of the latest request.
 * Evidence and decision flags are discarded after validation; only the model's
 * explicitly identified durable preference is persisted.
 */
export function validatePreferenceCandidate(candidate, query) {
  if (!isObject(candidate) || typeof query !== "string") return null;
  const kind = candidate.kind;
  const polarity = candidate.polarity;
  const value = compact(candidate.value, LEARNED_PREFERENCE_LIMITS.valueCharacters);
  const evidence = compact(candidate.evidence, LEARNED_PREFERENCE_LIMITS.valueCharacters);
  if (candidate.explicit !== true || candidate.durable !== true ||
    !KIND_SET.has(kind) || (polarity !== "like" && polarity !== "avoid") || !value || !evidence) return null;
  if (!query.toLocaleLowerCase().includes(evidence.toLocaleLowerCase())) return null;
  return { kind, polarity, value };
}

export function validatePreferenceCandidates(candidates, query) {
  const valid = [];
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const safe = validatePreferenceCandidate(candidate, query);
    if (safe) valid.push(safe);
    if (valid.length === LEARNED_PREFERENCE_LIMITS.candidatesPerTurn) break;
  }
  return valid;
}

export function mergeLearnedPreferences(current, candidates, query, { now = new Date().toISOString() } = {}) {
  const base = sanitizeLearnedPreferences(current, { now }) || defaultLearnedPreferences();
  const incoming = validatePreferenceCandidates(candidates, query);
  const items = base.items.map((item) => ({ ...item }));
  let changed = false;

  for (const candidate of incoming) {
    const key = `${candidate.kind}\u0000${candidate.value.toLocaleLowerCase()}`;
    const index = items.findIndex((item) => `${item.kind}\u0000${item.value.toLocaleLowerCase()}` === key);
    if (index >= 0) {
      if (items[index].polarity !== candidate.polarity) {
        items[index].polarity = candidate.polarity;
        changed = true;
      }
      items[index].lastConfirmedAt = now;
      continue;
    }
    if (items.length >= LEARNED_PREFERENCE_LIMITS.items) break;
    items.push({ id: defaultId(), ...candidate, createdAt: now, lastConfirmedAt: now });
    changed = true;
  }

  return {
    schema: LEARNED_PREFERENCES_SCHEMA_VERSION,
    updatedAt: changed || incoming.length ? now : base.updatedAt,
    revision: changed ? base.revision + 1 : base.revision,
    items
  };
}

export function renderLearnedContext(learned) {
  const safe = sanitizeLearnedPreferences(learned);
  if (!safe?.items.length) return "";
  const lines = ["## Learned from chats"];
  for (const item of safe.items) {
    const verb = item.polarity === "avoid" ? "Avoid" : "Likes";
    const line = `- ${verb}: ${item.value} (${item.kind})`;
    if (lines.join("\n").length + line.length + 1 > LEARNED_PREFERENCE_LIMITS.contextCharacters) break;
    lines.push(line);
  }
  return lines.length > 1 ? lines.join("\n") : "";
}
