import { buildIndex, filterIndices, normalizeTitle, search as searchIndex } from "./catalog.js";

export const EXECUTION_LIMITS = Object.freeze({
  codeCharacters: 12000,
  maxDepth: 8,
  maxNodes: 5000,
  maxArrayItems: 100,
  maxStringCharacters: 2000,
  maxOutputBytes: 65536
});

class CatalogExecutionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CatalogExecutionError";
    this.code = code;
  }
}

function executionError(code, message) {
  return new CatalogExecutionError(code, message);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreezePlain(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  if (!Array.isArray(value) && !isPlainObject(value)) return value;
  seen.add(value);
  for (const key of Object.keys(value)) deepFreezePlain(value[key], seen);
  return Object.freeze(value);
}

function asPlainObject(value) {
  return isPlainObject(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toLimit(value, fallback = 10) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(EXECUTION_LIMITS.maxArrayItems, Math.floor(number)));
}

function prepareSample(records, sample) {
  const byId = new Map(records.map((record) => [record?.id, record]));
  if (!Array.isArray(sample)) return records.slice(0, EXECUTION_LIMITS.maxArrayItems);
  return sample
    .map((entry) => typeof entry === "string" ? byId.get(entry) : entry)
    .filter((entry) => isPlainObject(entry))
    .slice(0, EXECUTION_LIMITS.maxArrayItems);
}

/**
 * Parses the JSON projection supplied to the worker and exposes only frozen,
 * serializable catalog data to executed code.
 */
export function prepareExecutionEnvironment(projectionJson) {
  if (typeof projectionJson !== "string") {
    throw executionError("INVALID_PROJECTION", "Catalog projection must be JSON.");
  }

  let projection;
  try {
    projection = JSON.parse(projectionJson);
  } catch {
    throw executionError("INVALID_PROJECTION", "Catalog projection is not valid JSON.");
  }
  if (!isPlainObject(projection)) {
    throw executionError("INVALID_PROJECTION", "Catalog projection must be an object.");
  }

  const records = asArray(projection.records);
  const catalog = {
    records,
    meta: asPlainObject(projection.meta),
    fields: Array.isArray(projection.fields) || isPlainObject(projection.fields)
      ? projection.fields
      : [],
    sample: prepareSample(records, projection.sample),
    context: asPlainObject(projection.context)
  };
  deepFreezePlain(catalog);

  let index = null;
  const byId = new Map(records
    .filter((record) => isPlainObject(record) && typeof record.id === "string")
    .map((record) => [record.id, record]));
  const ensureIndex = () => {
    if (!index) index = buildIndex(records);
    return index;
  };
  const where = (filters = {}) => filterIndices(records, asPlainObject(filters))
    .map((recordIndex) => records[recordIndex]);
  const search = (query, options = {}) => {
    const normalizedOptions = asPlainObject(options);
    const limit = toLimit(normalizedOptions.limit, 50);
    const allowedRecords = normalizedOptions.filters
      ? new Set(filterIndices(records, asPlainObject(normalizedOptions.filters)))
      : null;
    return searchIndex(ensureIndex(), String(query ?? ""), { limit, allow: allowedRecords })
      .map(({ i }) => records[i]);
  };
  const get = (ids) => asArray(ids)
    .map((id) => byId.get(id))
    .filter(Boolean)
    .slice(0, EXECUTION_LIMITS.maxArrayItems);
  const sample = (count = 10, filters = null) => {
    let limit = count;
    let activeFilters = filters;
    if (isPlainObject(count)) {
      limit = count.limit;
      activeFilters = count.filters ?? count;
    }
    const source = activeFilters ? where(activeFilters) : catalog.sample;
    return source.slice(0, toLimit(limit, 10));
  };

  return Object.freeze({
    catalog,
    helpers: Object.freeze({ search, where, get, sample, normalizeTitle })
  });
}

function sanitizeOutput(value) {
  const seen = new WeakSet();
  let nodes = 0;

  const visit = (current, depth) => {
    if (depth > EXECUTION_LIMITS.maxDepth) {
      throw executionError("OUTPUT_LIMIT", "Output exceeds the maximum depth.");
    }
    nodes += 1;
    if (nodes > EXECUTION_LIMITS.maxNodes) {
      throw executionError("OUTPUT_LIMIT", "Output contains too many values.");
    }

    if (current === null || typeof current === "boolean") return current;
    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        throw executionError("INVALID_OUTPUT", "Output must contain finite numbers.");
      }
      return current;
    }
    if (typeof current === "string") {
      if (current.length > EXECUTION_LIMITS.maxStringCharacters) {
        throw executionError("OUTPUT_LIMIT", "Output string is too long.");
      }
      return current;
    }
    if (typeof current === "undefined" || typeof current === "bigint"
      || typeof current === "function" || typeof current === "symbol") {
      throw executionError("INVALID_OUTPUT", "Output contains an unsupported value.");
    }
    if (typeof current !== "object" || (!Array.isArray(current) && !isPlainObject(current))) {
      throw executionError("INVALID_OUTPUT", "Output must contain only plain objects and arrays.");
    }
    if (seen.has(current)) {
      throw executionError("INVALID_OUTPUT", "Output contains a cycle.");
    }
    seen.add(current);

    if (Array.isArray(current)) {
      if (current.length > EXECUTION_LIMITS.maxArrayItems) {
        throw executionError("OUTPUT_LIMIT", "Output array has too many items.");
      }
      const output = [];
      for (let index = 0; index < current.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
        if (!descriptor || !("value" in descriptor)) {
          throw executionError("INVALID_OUTPUT", "Output arrays cannot contain accessors or holes.");
        }
        output.push(visit(descriptor.value, depth + 1));
      }
      return output;
    }

    const output = Object.create(null);
    for (const key of Object.keys(current)) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (!descriptor || !("value" in descriptor)) {
        throw executionError("INVALID_OUTPUT", "Output objects cannot contain accessors.");
      }
      Object.defineProperty(output, key, {
        value: visit(descriptor.value, depth + 1),
        enumerable: true,
        configurable: false,
        writable: false
      });
    }
    return output;
  };

  const output = visit(value, 0);
  let json;
  try {
    json = JSON.stringify(output);
  } catch {
    throw executionError("INVALID_OUTPUT", "Output could not be serialized.");
  }
  if (new TextEncoder().encode(json).length > EXECUTION_LIMITS.maxOutputBytes) {
    throw executionError("OUTPUT_LIMIT", "Output exceeds the byte limit.");
  }
  return { output, json };
}

function findObservedIds(value, records) {
  const knownIds = new Set(records
    .filter((record) => isPlainObject(record) && typeof record.id === "string")
    .map((record) => record.id));
  const observed = new Set();

  const inspect = (current, key = "", scoped = false) => {
    if (typeof current === "string") {
      if ((key === "id" || key === "ids" || scoped) && knownIds.has(current)) observed.add(current);
      return;
    }
    if (current === null || typeof current !== "object") return;
    if (Array.isArray(current)) {
      for (const item of current) inspect(item, key, scoped || key === "ids");
      return;
    }
    const id = Object.getOwnPropertyDescriptor(current, "id")?.value;
    const recordScoped = scoped || (typeof id === "string" && knownIds.has(id));
    for (const childKey of Object.keys(current)) inspect(current[childKey], childKey, recordScoped);
  };

  inspect(value);
  return [...observed];
}

/**
 * Runs user supplied code with the catalog and helper API as its only
 * parameters. Errors intentionally omit the original exception and stack.
 */
export async function executeCatalogCode(code, environment) {
  if (typeof code !== "string" || !code.trim()) {
    throw executionError("INVALID_CODE", "Code must be a non-blank string.");
  }
  if (code.length > EXECUTION_LIMITS.codeCharacters) {
    throw executionError("CODE_LIMIT", "Code exceeds the character limit.");
  }
  if (/\bimport\b/.test(code)) {
    throw executionError("FORBIDDEN_CAPABILITY", "Import is not allowed.");
  }
  if (!environment || !environment.catalog || !environment.helpers) {
    throw executionError("INVALID_ENVIRONMENT", "Execution environment is invalid.");
  }

  let result;
  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const run = new AsyncFunction("catalog", "helpers", `"use strict";\n${code}`);
    result = await run(environment.catalog, environment.helpers);
  } catch (error) {
    if (error instanceof CatalogExecutionError) throw error;
    throw executionError("EXECUTION_ERROR", "Code execution failed.");
  }

  const { output, json } = sanitizeOutput(result);
  return {
    json,
    observedIds: findObservedIds(output, environment.catalog.records),
    count: Array.isArray(output) ? output.length : 1
  };
}
