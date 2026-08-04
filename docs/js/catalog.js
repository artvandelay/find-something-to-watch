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
  return { N: records.length, avgLen: records.length ? total / records.length : 0, len, df, postings };
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
  return [...scores.entries()].map(([i, score]) => ({ i, score }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit);
}

export function filterIndices(records, filters) {
  const f = filters || {};
  const isSet = (v) => v !== null && v !== undefined;
  const excluded = Array.isArray(f.excludeKeys) && f.excludeKeys.length
    ? new Set(f.excludeKeys)
    : null;
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
    if (excluded && excluded.has(normalizeTitle(rec.t))) continue;
    out.push(i);
  }
  return out;
}
