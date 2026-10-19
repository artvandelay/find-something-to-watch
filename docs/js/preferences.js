export const LEARNED_PREFERENCES_SCHEMA_VERSION = 1;
export const LEARNED_PREFERENCE_LIMITS = Object.freeze({
  items: 100,
  valueCharacters: 80,
  subjectCharacters: 80,
  reasonCharacters: 120,
  candidatesPerTurn: 8,
  contextCharacters: 4000
});

export const LEARNED_KINDS = Object.freeze([
  "genre", "language", "theme", "pace", "creator", "format", "content", "habit"
]);

const KIND_SET = new Set(LEARNED_KINDS);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function compact(value, max = Infinity) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function safeSubjectId(value) {
  const id = compact(value, LEARNED_PREFERENCE_LIMITS.subjectCharacters);
  return id && !/^https?:\/\//i.test(id) ? id : "";
}

function attachTripleFields(target, source) {
  const subjectId = safeSubjectId(source?.subjectId);
  const subjectTitle = compact(source?.subjectTitle, LEARNED_PREFERENCE_LIMITS.subjectCharacters);
  const reason = compact(source?.reason, LEARNED_PREFERENCE_LIMITS.reasonCharacters);
  if (subjectId) target.subjectId = subjectId;
  if (subjectTitle) target.subjectTitle = subjectTitle;
  if (reason) target.reason = reason;
  return target;
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
    const entry = attachTripleFields({
      id: compact(raw?.id, 160) || defaultId(),
      kind,
      polarity,
      value: itemValue,
      createdAt: validIso(raw?.createdAt) ? raw.createdAt : now,
      lastConfirmedAt: validIso(raw?.lastConfirmedAt) ? raw.lastConfirmedAt : now
    }, raw);
    items.push(entry);
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
  return attachTripleFields({ kind, polarity, value }, candidate);
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

export function validateWatchedCandidates(candidates, query) {
  if (typeof query !== "string") return [];
  const q = compact(query).toLocaleLowerCase();
  const seen = new Set();
  const out = [];
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const title = compact(candidate?.title, LEARNED_PREFERENCE_LIMITS.valueCharacters);
    const evidence = compact(candidate?.evidence, LEARNED_PREFERENCE_LIMITS.valueCharacters);
    const key = title.toLocaleLowerCase();
    if (!title || !evidence || seen.has(key) || !q.includes(evidence.toLocaleLowerCase())) continue;
    seen.add(key);
    out.push(title);
    if (out.length === LEARNED_PREFERENCE_LIMITS.candidatesPerTurn) break;
  }
  return out;
}

function applyLearnedCandidate(items, candidate, now) {
  const key = `${candidate.kind}\u0000${candidate.value.toLocaleLowerCase()}`;
  const index = items.findIndex((item) => `${item.kind}\u0000${item.value.toLocaleLowerCase()}` === key);
  if (index >= 0) {
    const current = items[index];
    let changed = current.polarity !== candidate.polarity;
    if (changed) current.polarity = candidate.polarity;
    for (const field of ["subjectId", "subjectTitle", "reason"]) {
      if (candidate[field] && current[field] !== candidate[field]) {
        current[field] = candidate[field];
        changed = true;
      }
    }
    current.lastConfirmedAt = now;
    return changed;
  }
  if (items.length >= LEARNED_PREFERENCE_LIMITS.items) {
    let oldest = 0;
    for (let i = 1; i < items.length; i += 1) {
      if (Date.parse(items[i].lastConfirmedAt) < Date.parse(items[oldest].lastConfirmedAt)) oldest = i;
    }
    items.splice(oldest, 1);
  }
  items.push(attachTripleFields({ id: defaultId(), kind: candidate.kind, polarity: candidate.polarity, value: candidate.value, createdAt: now, lastConfirmedAt: now }, candidate));
  return true;
}

export function mergeLearnedPreferences(current, candidates, query, { now = new Date().toISOString() } = {}) {
  const base = sanitizeLearnedPreferences(current, { now }) || defaultLearnedPreferences();
  const incoming = validatePreferenceCandidates(candidates, query);
  const items = base.items.map((item) => ({ ...item }));
  let changed = false;

  for (const candidate of incoming) {
    if (applyLearnedCandidate(items, candidate, now)) changed = true;
  }

  return {
    schema: LEARNED_PREFERENCES_SCHEMA_VERSION,
    updatedAt: changed || incoming.length ? now : base.updatedAt,
    revision: changed ? base.revision + 1 : base.revision,
    items
  };
}

/**
 * UI-authored durable preference (pick feedback). Skips model evidence rules;
 * still constrained to known kinds, polarities, and value length.
 */
export function upsertLearnedPreference(current, candidate, { now = new Date().toISOString() } = {}) {
  const base = sanitizeLearnedPreferences(current, { now }) || defaultLearnedPreferences();
  const kind = typeof candidate?.kind === "string" ? candidate.kind : "";
  const polarity = candidate?.polarity;
  const value = compact(candidate?.value, LEARNED_PREFERENCE_LIMITS.valueCharacters);
  if (!KIND_SET.has(kind) || (polarity !== "like" && polarity !== "avoid") || !value) {
    return base;
  }
  const items = base.items.map((item) => ({ ...item }));
  const entry = attachTripleFields({ kind, polarity, value }, candidate);
  const changed = applyLearnedCandidate(items, entry, now);
  return {
    schema: LEARNED_PREFERENCES_SCHEMA_VERSION,
    updatedAt: changed ? now : base.updatedAt,
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
    const anchorParts = [];
    if (item.subjectTitle) anchorParts.push("from " + item.subjectTitle);
    else if (item.subjectId) anchorParts.push("from " + item.subjectId);
    if (item.reason) anchorParts.push(item.reason);
    const meta = anchorParts.length ? `${item.kind}; ${anchorParts.join(" — ")}` : item.kind;
    const line = `- ${verb}: ${item.value} (${meta})`;
    if (lines.join("\n").length + line.length + 1 > LEARNED_PREFERENCE_LIMITS.contextCharacters) break;
    lines.push(line);
  }
  return lines.length > 1 ? lines.join("\n") : "";
}
