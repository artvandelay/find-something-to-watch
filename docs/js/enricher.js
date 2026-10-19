import { callChatCompletion } from "./llm-client.js";
import { normalizeTitle } from "./catalog.js";
import {
  defaultLearnedPreferences,
  sanitizeLearnedPreferences,
  upsertLearnedPreference,
  LEARNED_KINDS
} from "./preferences.js";
import { resolveHistoryWithCatalog } from "./history.js";

export const ENRICH_PACE = Object.freeze(["slow", "medium", "fast"]);
export const ENRICH_TONE = Object.freeze(["bleak", "warm", "tense", "playful", "cerebral", "gritty"]);
export const ENRICH_FIT = Object.freeze(["solo", "family", "late-night", "weekend", "background"]);

const PACE_SET = new Set(ENRICH_PACE);
const TONE_SET = new Set(ENRICH_TONE);
const FIT_SET = new Set(ENRICH_FIT);
const KIND_SET = new Set(LEARNED_KINDS);

export function computeEnrichmentSignature({ history = null, learned = null, queue = null } = {}) {
  const seenCount = Array.isArray(history?.seen) ? history.seen.length : 0;
  const seriesCount = Array.isArray(history?.series) ? history.series.length : 0;
  const moviesCount = Array.isArray(history?.movies) ? history.movies.length : 0;
  const marksCount = Array.isArray(history?.marks) ? history.marks.length : 0;
  if (seenCount + seriesCount + moviesCount + marksCount === 0) return "";
  const firstSeen = (Array.isArray(history?.seen) ? history.seen.slice(0, 20) : []).map(String).join(",");
  const lastMarks = (Array.isArray(history?.marks) ? history.marks.slice(-10) : []).map((m) => {
    return typeof m === "object" && m ? m.key || "" : String(m || "");
  }).join(",");
  return `${seenCount}:${seriesCount}:${moviesCount}:${marksCount}:${firstSeen}:${lastMarks}`;
}

export function needsEnrichment({ history = null, learned = null, queue = null } = {}) {
  const sig = computeEnrichmentSignature({ history, learned, queue });
  if (!sig) return false;
  return history?.enrichedSignature !== sig;
}

export function heuristicTagsForRecord(rec) {
  const rt = Number.isInteger(rec?.rt) && rec.rt > 0 ? rec.rt : null;
  const genres = Array.isArray(rec?.g) ? rec.g : [];
  const hasGenre = (names) => names.some((n) => genres.includes(n));

  const pace = rt !== null ? (rt <= 95 ? "fast" : rt >= 140 ? "slow" : "medium") : "medium";

  let tone = "warm";
  if (hasGenre(["Horror", "War"])) {
    tone = "bleak";
  } else if (hasGenre(["Thriller", "Crime", "Mystery"])) {
    tone = "tense";
  } else if (hasGenre(["Comedy"])) {
    tone = "playful";
  } else if (hasGenre(["Family", "Romance"])) {
    tone = "warm";
  } else if (hasGenre(["Documentary", "Science Fiction"])) {
    tone = "cerebral";
  }

  let fit = "solo";
  if (hasGenre(["Family", "Kids", "Animation"])) {
    fit = "family";
  } else if (rt !== null && rt >= 135) {
    fit = "weekend";
  } else if (rt !== null && rt <= 95) {
    fit = "late-night";
  }

  return { pace, tone, fit };
}

export function enrichLocalSignals({ history = null, learned = null, records = [], now = () => new Date() } = {}) {
  const resolvedHistory = resolveHistoryWithCatalog(history, records);
  const nowVal = typeof now === "function" ? now() : now;
  const timestamp = (nowVal instanceof Date ? nowVal : new Date(nowVal)).toISOString();

  let nextLearned = sanitizeLearnedPreferences(learned, { now: timestamp }) || defaultLearnedPreferences();
  let factsAdded = 0;

  const recordsById = new Map();
  for (const rec of Array.isArray(records) ? records : []) {
    if (rec && typeof rec.id === "string") {
      recordsById.set(rec.id, rec);
    }
  }

  const matchedRecords = [];
  for (const id of Array.isArray(resolvedHistory?.resolvedIds) ? resolvedHistory.resolvedIds : []) {
    const rec = recordsById.get(id);
    if (rec) matchedRecords.push(rec);
  }

  const titleTags = { ...(resolvedHistory?.titleTags || {}) };
  for (const rec of matchedRecords) {
    const current = titleTags[rec.id] || {};
    const defaults = heuristicTagsForRecord(rec);
    titleTags[rec.id] = {
      pace: PACE_SET.has(current.pace) ? current.pace : defaults.pace,
      tone: TONE_SET.has(current.tone) ? current.tone : defaults.tone,
      fit: FIT_SET.has(current.fit) ? current.fit : defaults.fit
    };
  }

  if (matchedRecords.length >= 3) {
    const genreCounts = new Map();
    for (const rec of matchedRecords) {
      if (Array.isArray(rec.g)) {
        for (const g of rec.g) {
          if (typeof g === "string" && g.trim()) {
            const name = g.trim();
            genreCounts.set(name, (genreCounts.get(name) || 0) + 1);
          }
        }
      }
    }
    let topGenre = null;
    let topCount = 0;
    for (const [genre, count] of genreCounts.entries()) {
      if (count > topCount) {
        topGenre = genre;
        topCount = count;
      }
    }

    if (topGenre && topCount >= 3 && topCount / matchedRecords.length >= 0.5) {
      const beforeLen = nextLearned.items.length;
      nextLearned = upsertLearnedPreference(
        nextLearned,
        {
          kind: "genre",
          polarity: "like",
          value: topGenre,
          reason: `In ${topCount} of ${matchedRecords.length} watched titles`
        },
        { now: timestamp }
      );
      if (nextLearned.items.length > beforeLen) factsAdded++;
    }

    const watchedMoviesWithRt = (Array.isArray(resolvedHistory?.movies) ? resolvedHistory.movies : []).filter(
      (m) => Number.isInteger(m?.rt) && m.rt > 0
    );
    const shortMovies = watchedMoviesWithRt.filter((m) => m.rt <= 100);
    if (shortMovies.length >= 3 && shortMovies.length / watchedMoviesWithRt.length >= 0.6) {
      const beforeLen = nextLearned.items.length;
      nextLearned = upsertLearnedPreference(
        nextLearned,
        {
          kind: "habit",
          polarity: "like",
          value: "movies under 100 minutes",
          reason: `${shortMovies.length} of ${watchedMoviesWithRt.length} watched films`
        },
        { now: timestamp }
      );
      if (nextLearned.items.length > beforeLen) factsAdded++;
    }
  }

  const nextHistory = {
    ...resolvedHistory,
    titleTags
  };

  return {
    history: nextHistory,
    learned: nextLearned,
    resolvedCount: Array.isArray(nextHistory.resolvedIds) ? nextHistory.resolvedIds.length : 0,
    taggedCount: Object.keys(titleTags).length,
    factsAdded
  };
}

export function validateEnrichmentPayload(raw, allowedIds) {
  const out = { titleTags: {}, preferences: [] };
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      const stripped = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
      parsed = JSON.parse(stripped);
    } catch {
      return out;
    }
  }
  if (!parsed || typeof parsed !== "object") return out;

  const validIds = allowedIds instanceof Set ? allowedIds : new Set(Array.isArray(allowedIds) ? allowedIds : []);

  if (parsed.titleTags && typeof parsed.titleTags === "object" && !Array.isArray(parsed.titleTags)) {
    let count = 0;
    for (const [id, tags] of Object.entries(parsed.titleTags)) {
      if (count >= 40) break;
      if (!validIds.has(id) || !tags || typeof tags !== "object" || Array.isArray(tags)) continue;
      const cleanTags = {};
      if (typeof tags.pace === "string" && PACE_SET.has(tags.pace)) cleanTags.pace = tags.pace;
      if (typeof tags.tone === "string" && TONE_SET.has(tags.tone)) cleanTags.tone = tags.tone;
      if (typeof tags.fit === "string" && FIT_SET.has(tags.fit)) cleanTags.fit = tags.fit;
      if (Object.keys(cleanTags).length > 0) {
        out.titleTags[id] = cleanTags;
        count++;
      }
    }
  }

  if (Array.isArray(parsed.preferences)) {
    for (const item of parsed.preferences) {
      if (out.preferences.length >= 6) break;
      if (!item || typeof item !== "object") continue;
      const kind = typeof item.kind === "string" ? item.kind : "";
      const polarity = item.polarity;
      const value = typeof item.value === "string" ? item.value.trim().slice(0, 80) : "";
      if (!KIND_SET.has(kind) || (polarity !== "like" && polarity !== "avoid") || !value) continue;

      const pref = { kind, polarity, value };
      if (typeof item.subjectId === "string" && validIds.has(item.subjectId)) {
        pref.subjectId = item.subjectId.slice(0, 80);
      }
      if (typeof item.subjectTitle === "string" && item.subjectTitle.trim()) {
        pref.subjectTitle = item.subjectTitle.trim().slice(0, 80);
      }
      if (typeof item.reason === "string" && item.reason.trim()) {
        pref.reason = item.reason.trim().slice(0, 120);
      }
      out.preferences.push(pref);
    }
  }

  return out;
}

export async function runEnricher({
  config = null,
  history = null,
  learned = null,
  queue = null,
  records = [],
  callImpl = callChatCompletion,
  fetchImpl = globalThis.fetch,
  signal = null,
  now = () => new Date()
} = {}) {
  const local = enrichLocalSignals({ history, learned, records, now });
  let nextHistory = local.history;
  let nextLearned = local.learned;
  let factsAdded = local.factsAdded;
  let usedModel = false;

  const candidateIds = new Set();
  for (const id of Array.isArray(nextHistory?.resolvedIds) ? nextHistory.resolvedIds : []) {
    candidateIds.add(id);
    if (candidateIds.size >= 12) break;
  }
  if (candidateIds.size < 12 && Array.isArray(queue?.items)) {
    for (const item of queue.items) {
      if (typeof item?.id === "string") {
        candidateIds.add(item.id);
        if (candidateIds.size >= 12) break;
      }
    }
  }

  const candidateRecords = [];
  for (const rec of Array.isArray(records) ? records : []) {
    if (rec && candidateIds.has(rec.id)) {
      candidateRecords.push(rec);
    }
  }

  const nowVal = typeof now === "function" ? now() : now;
  const timestamp = (nowVal instanceof Date ? nowVal : new Date(nowVal)).toISOString();

  if (config && typeof config.apiKey === "string" && config.apiKey.trim() !== "" && candidateRecords.length > 0) {
    const systemPrompt = `You are a Netflix taste enricher. Analyze the provided titles and infer closed-enum tags and taste preferences.
Closed enum sets:
pace: slow, medium, fast
tone: bleak, warm, tense, playful, cerebral, gritty
fit: solo, family, late-night, weekend, background
kind: genre, language, theme, pace, creator, format, content, habit

Return strictly valid JSON with no markdown wrapping:
{
  "titleTags": {
    "<id>": { "pace": "...", "tone": "...", "fit": "..." }
  },
  "preferences": [
    { "kind": "...", "polarity": "like"|"avoid", "value": "...", "subjectId": "<id>", "subjectTitle": "...", "reason": "..." }
  ]
}`;
    const userPrompt = `Enrich these catalog titles:\n${JSON.stringify(
      candidateRecords.map((r) => ({
        id: r.id,
        title: r.t,
        year: r.y,
        runtime: r.rt,
        genres: r.g,
        kind: r.k
      }))
    )}`;

    try {
      const response = await callImpl(
        config,
        {
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ]
        },
        { fetchImpl, signal }
      );
      const content = response?.choices?.[0]?.message?.content || "";
      const validated = validateEnrichmentPayload(content, candidateIds);
      nextHistory = {
        ...nextHistory,
        titleTags: {
          ...(nextHistory.titleTags || {}),
          ...validated.titleTags
        }
      };
      for (const pref of validated.preferences) {
        const beforeLen = nextLearned.items.length;
        nextLearned = upsertLearnedPreference(nextLearned, pref, { now: timestamp });
        if (nextLearned.items.length > beforeLen) factsAdded++;
      }
      usedModel = true;
    } catch (err) {
      if (err?.name === "AbortError" || signal?.aborted) throw err;
      // Degrade gracefully and keep local enrichment result
    }
  }

  const sig = computeEnrichmentSignature({ history: nextHistory, learned: nextLearned, queue });
  nextHistory = {
    ...nextHistory,
    enrichedAt: timestamp,
    enrichedSignature: sig
  };

  return {
    history: nextHistory,
    learned: nextLearned,
    resolvedCount: local.resolvedCount,
    taggedCount: Object.keys(nextHistory.titleTags || {}).length,
    factsAdded,
    usedModel
  };
}
