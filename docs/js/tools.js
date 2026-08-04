import { PROVIDER_SLUGS, intersectProviders } from "./providers.js";

const GENRE_NAMES = ["Action", "Adventure", "Animation", "Comedy", "Crime", "Documentary", "Drama",
  "Family", "Fantasy", "History", "Horror", "Music", "Mystery", "Romance", "Science Fiction",
  "TV Movie", "Thriller", "War", "Western", "Action & Adventure", "Kids", "News", "Reality",
  "Sci-Fi & Fantasy", "Soap", "Talk", "War & Politics"];

const LANGUAGE_PARAM = { type: "string", description: "ISO-639-1 language code, e.g. \"hi\"." };
const GENRE_PARAM = { type: "string", enum: GENRE_NAMES, description: "Genre name." };
const PROVIDER_PARAM = { type: "string", enum: PROVIDER_SLUGS, description: "Streaming provider slug." };

export function createTools(deps) {
  // deps.subscriptions is the visitor's selected provider slugs (a Set,
  // array, or omitted for "no gate" — used by scripts/tests that predate
  // subscription gating). It is AND-ed into every filter below and used to
  // trim every returned record's p/u down to only subscribed slugs, so the
  // agent (and any UI hydrating from these results) never sees or links to
  // a provider outside the visitor's subscriptions.
  const subscriptions = deps.subscriptions instanceof Set
    ? deps.subscriptions
    : Array.isArray(deps.subscriptions) ? new Set(deps.subscriptions) : null;
  const recordsById = deps.recordsById instanceof Map
    ? deps.recordsById
    : new Map(deps.records.map((record) => [record.id, record]));

  function scoped(rec) {
    return subscriptions ? intersectProviders(rec, subscriptions) : rec;
  }

  function shape(rec) {
    const r = scoped(rec);
    return {
      id: r.id,
      t: r.t,
      y: r.y,
      k: r.k,
      rt: r.rt,
      r: r.r,
      p: r.p,
      l: r.l,
      g: r.g,
      s: (r.s || "").slice(0, 220)
    };
  }

  function toFilters(args) {
    const a = args || {};
    const f = {};
    const set = (key, value) => {
      if (value !== undefined && value !== null) f[key] = value;
    };
    set("k", a.type);
    set("yearFrom", a.year_from);
    set("yearTo", a.year_to);
    set("runtimeMin", a.runtime_min);
    set("runtimeMax", a.runtime_max);
    set("minRating", a.min_rating);
    set("lang", a.language);
    set("genre", a.genre);
    set("provider", a.provider);
    if (subscriptions) f.providers = subscriptions;
    if (a.exclude_seen === true && deps.seenKeys.length > 0) f.excludeKeys = deps.seenKeys;
    return f;
  }

  function clampLimit(n, dflt) {
    return Math.min(50, Math.max(1, Number(n) || dflt));
  }

  const handlers = {
    async search_titles(args) {
      const allowed = deps.filterIndices(deps.records, toFilters(args));
      const hits = deps.search(deps.index, String((args || {}).query || ""), {
        limit: clampLimit((args || {}).limit, 20),
        allow: new Set(allowed)
      });
      return { count: hits.length, results: hits.map((h) => shape(deps.records[h.i])) };
    },

    async filter_titles(args) {
      const a = args || {};
      const idxs = deps.filterIndices(deps.records, toFilters(a)).slice();
      const recs = deps.records;
      if (a.sort === "rating") {
        idxs.sort((x, y) => (recs[y].r ?? -1) - (recs[x].r ?? -1));
      } else if (a.sort === "year") {
        idxs.sort((x, y) => (recs[y].y ?? -1) - (recs[x].y ?? -1));
      } else if (a.sort === "runtime") {
        idxs.sort((x, y) => (recs[x].rt ?? 99999) - (recs[y].rt ?? 99999));
      }
      const picked = idxs.slice(0, clampLimit(a.limit, 20));
      return { count: picked.length, results: picked.map((i) => shape(recs[i])) };
    },

    async get_titles(args) {
      const a = args || {};
      const ids = Array.isArray(a.ids) ? a.ids : [];
      const requested = ids.map((id) => recordsById.get(id)).filter(Boolean);
      const found = deps
        .filterIndices(requested, toFilters(a))
        .map((index) => requested[index]);
      return { count: found.length, results: found.map(scoped) };
    },

    async sample_titles(args) {
      const a = args || {};
      const idxs = deps.filterIndices(deps.records, toFilters(a)).slice();
      const n = clampLimit(a.n, 5);
      let next = Math.random;
      if (typeof a.seed === "number") {
        let x = a.seed >>> 0;
        next = () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296;
      }
      for (let i = idxs.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const tmp = idxs[i];
        idxs[i] = idxs[j];
        idxs[j] = tmp;
      }
      const picked = idxs.slice(0, n);
      return { count: picked.length, results: picked.map((i) => shape(deps.records[i])) };
    }
  };

  const schemas = [
    {
      type: "function",
      function: {
        name: "search_titles",
        description: "Full-text search the India OTT catalog by meaning. The query is matched against title and synopsis, so describe the plot, mood, or theme rather than guessing an exact title.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Free-text description of what to look for." },
            type: { type: "string", enum: ["movie", "series"] },
            year_from: { type: "integer" },
            year_to: { type: "integer" },
            runtime_min: { type: "integer", description: "Minutes." },
            runtime_max: { type: "integer", description: "Minutes." },
            min_rating: { type: "number", description: "TMDB rating floor, 0-10." },
            language: LANGUAGE_PARAM,
            genre: GENRE_PARAM,
            provider: PROVIDER_PARAM,
            exclude_seen: { type: "boolean", description: "Drop titles the user has already watched." },
            limit: { type: "integer", description: "1-50, default 20." }
          },
          required: ["query"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "filter_titles",
        description: "List catalog titles by structured filters only, with no text query. Use for browsing, e.g. highly rated short series from the last five years.",
        parameters: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["movie", "series"] },
            year_from: { type: "integer" },
            year_to: { type: "integer" },
            runtime_min: { type: "integer" },
            runtime_max: { type: "integer" },
            min_rating: { type: "number", description: "TMDB rating floor, 0-10." },
            language: LANGUAGE_PARAM,
            genre: GENRE_PARAM,
            provider: PROVIDER_PARAM,
            exclude_seen: { type: "boolean" },
            sort: { type: "string", enum: ["rating", "year", "runtime"] },
            limit: { type: "integer", description: "1-50, default 20." }
          },
          required: []
        }
      }
    },
    {
      type: "function",
      function: {
        name: "get_titles",
        description: "Fetch the complete record, including the full synopsis and watch URL, for specific catalog ids. Call this once with all the ids you shortlisted.",
        parameters: {
          type: "object",
          properties: {
            ids: {
              type: "array",
              items: { type: "string" },
              description: "Catalog ids such as tmdb:m27205."
            },
            language: LANGUAGE_PARAM,
            genre: GENRE_PARAM,
            provider: PROVIDER_PARAM
          },
          required: ["ids"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "sample_titles",
        description: "Return a random sample of titles matching optional filters. Use when the user wants a surprise or when search returns too few results.",
        parameters: {
          type: "object",
          properties: {
            n: { type: "integer", description: "1-50, default 5." },
            type: { type: "string", enum: ["movie", "series"] },
            year_from: { type: "integer" },
            min_rating: { type: "number", description: "TMDB rating floor, 0-10." },
            language: LANGUAGE_PARAM,
            genre: GENRE_PARAM,
            provider: PROVIDER_PARAM,
            exclude_seen: { type: "boolean" },
            seed: { type: "integer" }
          },
          required: []
        }
      }
    }
  ];

  return { schemas, handlers };
}
