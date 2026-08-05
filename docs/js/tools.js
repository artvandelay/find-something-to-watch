const MAX_CODE_LENGTH = 12000;
const MAX_RESOLVE_IDS = 20;

const DESCRIPTION = `Run JavaScript analysis against the complete catalog inside the visitor's hard subscription scope. The code receives:
- catalog.records: every scoped analytical record; catalog.meta, catalog.fields, catalog.sample, and catalog.context describe it.
- helpers.search(query, options), helpers.where(filters), helpers.get(ids), helpers.sample(n), and helpers.normalizeTitle(value): optional convenience APIs.

You may ignore helpers and use ordinary JavaScript directly on catalog.records: filter, map, sort, regex, grouping, and custom scoring all work. Explicitly return a JSON-serializable value. Keep the analysis focused: code is limited to ${MAX_CODE_LENGTH} characters, output is bounded, and only IDs observed in the returned data (or already in the current queue) can be resolved into full records later.

Example:
const matches = helpers.search("gentle comedy", { limit: 8 });
return matches.map(({ id, t, y, r }) => ({ id, t, y, r }));`;

function failure(error, code) {
  return { error: String(error || "Catalog runtime failed."), code: code || "runtime", count: 0 };
}

function validId(id) {
  return typeof id === "string" && id.trim() !== "";
}

function uniqueIds(ids, limit = Infinity) {
  const unique = [];
  const seen = new Set();
  for (const id of Array.isArray(ids) ? ids : []) {
    if (!validId(id) || seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
    if (unique.length === limit) break;
  }
  return unique;
}

function normalizedKeys(keys) {
  const normalized = [];
  const seen = new Set();
  for (const key of Array.isArray(keys) ? keys : []) {
    if (typeof key !== "string") continue;
    const value = key.trim();
    if (value === "" || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

function abortError() {
  const error = new Error("The catalog request was aborted.");
  error.name = "AbortError";
  return error;
}

export function createTools({ runtime, scope, currentQueueIds = [], seenKeys = [] } = {}) {
  const observedIds = new Set(uniqueIds(currentQueueIds));
  const normalizedSeenKeys = normalizedKeys(seenKeys);

  async function runCatalogJs(args, signal) {
    if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).length !== 1
      || typeof args.code !== "string" || args.code.trim() === "" || args.code.length > MAX_CODE_LENGTH) {
      return failure("Expected a non-empty code string no longer than 12000 characters.", "invalid_args");
    }
    if (!runtime || typeof runtime.runCode !== "function") {
      return failure("Catalog runtime is unavailable.", "runtime");
    }

    try {
      if (signal?.aborted) throw abortError();
      const response = await runtime.runCode({ code: args.code, scope, excludeKeys: normalizedSeenKeys });
      for (const id of uniqueIds(response && response.observedIds)) observedIds.add(id);
      if (!response || typeof response.result !== "string") {
        return failure("Catalog runtime returned no serialized result.", "runtime");
      }

      let result;
      try {
        result = JSON.parse(response.result);
      } catch {
        return failure("Catalog runtime returned an invalid serialized result.", "runtime");
      }
      return { result, count: uniqueIds(response.observedIds).length };
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      return failure(err && err.message, (err && err.code) || "runtime");
    }
  }

  async function resolve(ids, signal) {
    const requested = uniqueIds(ids).filter((id) => observedIds.has(id)).slice(0, MAX_RESOLVE_IDS);
    if (requested.length === 0) return [];
    if (!runtime || typeof runtime.resolve !== "function") return [];
    if (signal?.aborted) throw abortError();
    return await runtime.resolve({ ids: requested, scope });
  }

  return {
    schemas: [
      {
        type: "function",
        function: {
          name: "run_catalog_js",
          description: DESCRIPTION,
          parameters: {
            type: "object",
            properties: {
              code: {
                type: "string",
                maxLength: MAX_CODE_LENGTH,
                description: "Scoped catalog analysis JavaScript with an explicit JSON-serializable return value."
              }
            },
            required: ["code"],
            additionalProperties: false
          }
        }
      }
    ],
    handlers: { run_catalog_js: runCatalogJs },
    resolve
  };
}
