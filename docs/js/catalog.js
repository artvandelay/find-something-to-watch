const STOP = new Set(["a","an","and","are","as","at","be","but","by","for","from","has","have","he",
  "her","his","in","into","is","it","its","of","on","or","she","that","the","their","them","they",
  "this","to","was","were","what","when","which","who","will","with","you","your"]);

const K1 = 1.2;
const B = 0.75;

export function normalizeTitle(s) {
  return String(s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

export function tokenize(s) {
  const norm = normalizeTitle(s);
  if (!norm) return [];
  return norm.split(" ").filter((w) => w.length >= 2 && !STOP.has(w));
}

export function buildIndex(records) {
  const df = new Map();
  const postings = new Map();
  const len = new Int32Array(records.length);
  let total = 0;
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const toks = tokenize(r.t + " " + r.t + " " + (r.s || ""));
    len[i] = toks.length;
    total += toks.length;
    const tf = new Map();
    for (const w of toks) tf.set(w, (tf.get(w) || 0) + 1);
    for (const [w, n] of tf) {
      df.set(w, (df.get(w) || 0) + 1);
      let p = postings.get(w);
      if (!p) { p = []; postings.set(w, p); }
      p.push(i, n);
    }
  }
  const votes = new Int32Array(records.length);
  for (let i = 0; i < records.length; i++) votes[i] = records[i].v || 0;
  return { N: records.length, avgLen: records.length ? total / records.length : 0, len, df, postings, votes };
}

export function search(index, query, options = {}) {
  const { limit = 50, allow = null } = options;
  const terms = tokenize(query);
  if (!terms.length) return [];
  if (!index.avgLen) return [];
  const scores = new Map();
  for (const w of terms) {
    const p = index.postings.get(w);
    if (!p) continue;
    const dfw = index.df.get(w) || 0;
    const idf = Math.log(1 + (index.N - dfw + 0.5) / (dfw + 0.5));
    for (let j = 0; j < p.length; j += 2) {
      const d = p[j];
      if (allow && !allow.has(d)) continue;
      const tf = p[j + 1];
      const norm = tf * (K1 + 1) / (tf + K1 * (1 - B + B * index.len[d] / index.avgLen));
      scores.set(d, (scores.get(d) || 0) + idf * norm);
    }
  }
  return [...scores.entries()].map(([i, score]) => {
    const votes = index.votes ? index.votes[i] : 0;
    return { i, score: score * (1 + 0.12 * Math.log10(1 + votes)) };
  })
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit);
}

export function filterIndices(records, filters) {
  const f = filters || {};
  const isSet = (v) => v !== null && v !== undefined;
  const excluded = Array.isArray(f.excludeKeys) && f.excludeKeys.length
    ? new Set(f.excludeKeys)
    : null;
  // f.providers is the visitor's subscription gate: a Set (or array) of
  // allowed provider slugs. Unlike f.provider (a single facet the caller
  // asked to narrow to), this is an AND-ed availability boundary applied on
  // top of everything else — every surviving record must carry at least one
  // subscribed slug. An empty set means "no subscriptions" and excludes all.
  const providers = f.providers instanceof Set
    ? f.providers
    : Array.isArray(f.providers) ? new Set(f.providers) : null;
  const out = [];
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    if (isSet(f.k) && rec.k !== f.k) continue;
    if (isSet(f.yearFrom) && (rec.y === null || rec.y < f.yearFrom)) continue;
    if (isSet(f.yearTo) && (rec.y === null || rec.y > f.yearTo)) continue;
    if (isSet(f.runtimeMin) && (rec.rt === null || rec.rt < f.runtimeMin)) continue;
    if (isSet(f.runtimeMax) && (rec.rt === null || rec.rt > f.runtimeMax)) continue;
    if (isSet(f.minRating) && (rec.r === null || rec.r < f.minRating)) continue;
    if (isSet(f.provider) && !rec.p.includes(f.provider)) continue;
    if (providers && !rec.p.some((slug) => providers.has(slug))) continue;
    if (isSet(f.lang) && rec.l !== f.lang) continue;
    if (isSet(f.genre) && !(rec.g || []).includes(f.genre)) continue;
    if (excluded && excluded.has(normalizeTitle(rec.t))) continue;
    out.push(i);
  }
  return out;
}

/**
 * Ranks catalog ids for the pre-chat recommendation queue without any LLM
 * call: subscribed-provider, unseen titles ordered by a vote-weighted rating
 * that reuses the frozen popularity-prior shape from search() (rating as the
 * base score, boosted by log10(1 + votes) instead of bm25). Capped at
 * options.limit (default 20).
 */
export function seedQueue(records, options = {}) {
  const { providers = null, excludeKeys = null, limit = 20 } = options;
  const cap = Math.max(0, Math.floor(Number(limit) || 0));
  if (cap === 0) return [];
  const idxs = filterIndices(records, { providers, excludeKeys });
  const top = [];
  const isBetter = (a, b) => a.score > b.score || (a.score === b.score && a.i < b.i);
  for (const i of idxs) {
    const rec = records[i];
    const votes = rec.v || 0;
    const rating = rec.r || 0;
    const candidate = { i, score: rating * (1 + 0.12 * Math.log10(1 + votes)) };
    const position = top.findIndex((existing) => isBetter(candidate, existing));
    if (position >= 0) top.splice(position, 0, candidate);
    else if (top.length < cap) top.push(candidate);
    if (top.length > cap) top.pop();
  }
  return top.map((entry) => records[entry.i].id);
}
