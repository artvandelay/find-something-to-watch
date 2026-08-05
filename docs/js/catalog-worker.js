import { buildIndex, filterIndices, search, seedQueue as rankSeedQueue } from "./catalog.js";

const V = 2;
const EXECUTOR_READY_MS = 10_000;
const EXECUTOR_RUN_MS = 3_000;
const PROJECTION_KEYS = ["id", "t", "y", "k", "rt", "s", "im", "r", "p", "l", "g", "v"];

let currentEpoch = 0;
let catalog = null;
let richCatalog = null;
let loading = null;
let richLoading = null;
const executors = new Map();
const cancelled = new Set();
const MAX_CANCELLED_REQUESTS = 256;

function fault(code, message, retryable, phase) {
  return { code, message, retryable: Boolean(retryable), phase };
}

function respond(epoch, id, value) {
  postMessage({ v: V, type: "response", epoch, id, ok: true, value });
}

function reject(epoch, id, error) {
  postMessage({ v: V, type: "response", epoch, id, ok: false, error });
}

function requestKey(epoch, id) {
  return `${epoch}:${id}`;
}

function rememberCancelled(key) {
  cancelled.add(key);
  while (cancelled.size > MAX_CANCELLED_REQUESTS) {
    cancelled.delete(cancelled.values().next().value);
  }
}

function isCancelled(key) {
  return cancelled.has(key);
}

function setState(epoch, state, detail = null) {
  postMessage({ v: V, type: "event", epoch, state, detail });
}

function validRecord(record) {
  return record && typeof record.id === "string" && typeof record.t === "string"
    && Array.isArray(record.p) && record.p.length > 0;
}

function scopeInput(payload) {
  return payload && payload.scope && typeof payload.scope === "object" ? payload.scope : payload || {};
}

function toScope(payload) {
  const scope = scopeInput(payload);
  const subscriptions = Array.isArray(scope.subscriptions) ? scope.subscriptions : [];
  return {
    subscriptions: new Set(subscriptions.filter((value) => typeof value === "string"))
  };
}

function scopeFilters(payload) {
  const scope = toScope(payload);
  return {
    excludeKeys: Array.isArray(payload?.excludeKeys) ? payload.excludeKeys : [],
    providers: scope.subscriptions
  };
}

function card(record, scope) {
  const subscribed = record.p.filter((provider) => scope.subscriptions.has(provider));
  const urls = {};
  for (const provider of subscribed) {
    if (record.u && typeof record.u[provider] === "string") urls[provider] = record.u[provider];
  }
  return {
    id: record.id,
    t: record.t,
    y: record.y,
    k: record.k,
    rt: record.rt,
    r: record.r,
    p: subscribed,
    u: urls,
    img: record.img ?? null,
    s: record.s || "",
    l: record.l || null,
    g: Array.isArray(record.g) ? record.g : [],
    reason: ""
  };
}

function projection(record, scope) {
  const result = {};
  for (const key of PROJECTION_KEYS) result[key] = record[key];
  result.p = record.p.filter((provider) => scope.subscriptions.has(provider));
  return result;
}

function requireCatalog() {
  if (!catalog) throw fault("NOT_READY", "Catalog is still loading.", true, "catalog");
  return richCatalog || catalog;
}

async function loadCatalog(epoch) {
  if (catalog) return catalog;
  if (loading) return loading;
  loading = (async () => {
    setState(epoch, "BOOTING");
    let response;
    try {
      response = await fetch("../assets/catalog.json", { cache: "default" });
    } catch {
      throw fault("CATALOG_FETCH_FAILED", "Could not load the catalog.", true, "catalog");
    }
    if (!response.ok) throw fault("CATALOG_FETCH_FAILED", "Could not load the catalog.", true, "catalog");
    let data;
    try {
      data = await response.json();
    } catch {
      throw fault("CATALOG_INVALID", "Catalog data is invalid.", false, "catalog");
    }
    if (!data || !Array.isArray(data.records) || !data.records.every(validRecord)) {
      throw fault("CATALOG_INVALID", "Catalog data is invalid.", false, "catalog");
    }
    const records = data.records;
    catalog = { meta: data.meta || {}, records, index: buildIndex(records), byId: new Map(records.map((r) => [r.id, r])) };
    setState(epoch, "READY_BASIC", { meta: catalog.meta });
    void loadSidecar(epoch);
    return catalog;
  })();
  try {
    return await loading;
  } finally {
    loading = null;
  }
}

async function loadSidecar(epoch) {
  if (richCatalog || richLoading || !catalog) return richCatalog;
  richLoading = (async () => {
    const textFile = String(catalog.meta.text_file || "catalog.text.json");
    let response;
    try {
      response = await fetch("../assets/" + textFile, { cache: "default" });
    } catch {
      return null;
    }
    if (!response.ok) return null;
    let data;
    try {
      data = await response.json();
    } catch {
      return null;
    }
    if (!data || !data.s || typeof data.s !== "object") return null;
    const records = catalog.records.map((record) => ({
      ...record,
      s: typeof data.s[record.id] === "string" ? data.s[record.id] : record.s
    }));
    richCatalog = { ...catalog, records, index: buildIndex(records), byId: new Map(records.map((r) => [r.id, r])) };
    setState(epoch, "READY_RICH", { meta: richCatalog.meta });
    return richCatalog;
  })();
  try {
    return await richLoading;
  } finally {
    richLoading = null;
  }
}

function scopedRecords(source, payload) {
  const filters = scopeFilters(payload);
  const scope = toScope(payload);
  if (scope.subscriptions.size === 0) return { scope, filters, indices: [] };
  return { scope, filters, indices: filterIndices(source.records, filters) };
}

function limited(value, fallback = 20) {
  return Math.min(50, Math.max(1, Math.floor(Number(value) || fallback)));
}

function keywordSearch(payload) {
  const source = requireCatalog();
  const { scope, indices } = scopedRecords(source, payload);
  const hits = search(source.index, String(payload?.query || ""), {
    limit: limited(payload?.limit),
    allow: new Set(indices)
  });
  return { count: hits.length, results: hits.map(({ i }) => card(source.records[i], scope)) };
}

function resolve(payload) {
  const source = requireCatalog();
  const { scope, indices } = scopedRecords(source, payload);
  const allowed = new Set(indices.map((i) => source.records[i].id));
  const ids = Array.isArray(payload?.ids) ? payload.ids : [];
  const results = [];
  for (const id of ids) {
    if (!allowed.has(id)) continue;
    const record = source.byId.get(id);
    if (record) results.push(card(record, scope));
  }
  return { count: results.length, results };
}

function seedQueue(payload) {
  const source = requireCatalog();
  const { scope, filters, indices } = scopedRecords(source, payload);
  const allowed = new Set(indices);
  const ids = rankSeedQueue(source.records, {
    providers: scope.subscriptions,
    excludeKeys: filters.excludeKeys,
    limit: limited(payload?.limit, 20)
  }).filter((id) => allowed.has(source.records.findIndex((record) => record.id === id)));
  return { count: ids.length, results: ids.map((id) => card(source.byId.get(id), scope)) };
}

function describe(payload) {
  const source = requireCatalog();
  const { scope, indices } = scopedRecords(source, payload);
  const manifest = {
    fields: {
      id: "Catalog id used only after it is observed in this tool result.",
      t: "Display title.",
      y: "Release year or null.",
      k: "movie or series.",
      rt: "Runtime in minutes or null.",
      s: "Synopsis, which may be empty while the rich index is loading.",
      im: "IMDb id or null.",
      r: "TMDB rating or null.",
      p: "Subscribed provider slugs only.",
      l: "ISO-639-1 original language or null.",
      g: "Genre names.",
      v: "TMDB vote count."
    },
    helperDocs: [
      "helpers.search(query, {limit, filters}) returns scoped analytical records.",
      "helpers.where(filters) applies structured catalog filters.",
      "helpers.get(ids) preserves requested ID order.",
      "helpers.sample(n) returns a small scoped sample.",
      "helpers.normalizeTitle(value) matches watched-title normalization."
    ],
    richIndexReady: Boolean(richCatalog),
    subscriptions: [...scope.subscriptions]
  };
  if (scope.subscriptions.size === 0) return {
    ...manifest,
    meta: { ...source.meta, count: 0, providers: [], provider_order: [], languages: [], genres: [] },
    sample: []
  };
  const records = indices.map((index) => source.records[index]);
  const providers = [...new Set(records.flatMap((record) => record.p.filter((slug) => scope.subscriptions.has(slug))))].sort();
  const languages = [...new Set(records.map((record) => record.l).filter(Boolean))].sort();
  const genres = [...new Set(records.flatMap((record) => record.g || []))].sort();
  return {
    ...manifest,
    meta: {
      ...source.meta,
      count: records.length,
      providers,
      provider_order: (source.meta.provider_order || []).filter((slug) => providers.includes(slug)),
      languages,
      genres
    },
    sample: records.slice(0, 3).map((record) => projection(record, scope))
  };
}

function waitForExecutor(executor, code, registerCancel) {
  return new Promise((resolve, reject) => {
    let ready = false;
    let timer = null;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      executor.onmessage = null;
      executor.onerror = null;
      executor.onmessageerror = null;
      if (error) reject(error);
      else resolve(value);
    };
    registerCancel(() => finish(fault("EXECUTOR_CANCELLED", "Code execution was cancelled.", true, "execute")));
    executor.onmessage = ({ data }) => {
      if (!data || typeof data !== "object") return;
      if (!ready && data.type === "ready") {
        ready = true;
        clearTimeout(timer);
        timer = setTimeout(() => finish(fault("EXECUTOR_TIMEOUT", "Code execution timed out.", true, "execute")), EXECUTOR_RUN_MS);
        executor.postMessage({ type: "execute", code });
        return;
      }
      if (data.type === "result" && data.result) finish(null, data.result);
      else if (data.type === "result" && data.error) finish(fault(
        data.error.code || "EXECUTOR_ERROR",
        data.error.message || "Code execution failed.",
        false,
        "execute"
      ));
      else if (data.type === "error") finish(fault(
        data.error?.code || "EXECUTOR_ERROR",
        data.error?.message || "Code execution failed.",
        false,
        "execute"
      ));
    };
    executor.onerror = () => finish(fault("EXECUTOR_ERROR", "Code execution failed.", true, "execute"));
    executor.onmessageerror = () => finish(fault("EXECUTOR_MESSAGE_ERROR", "Code executor sent an invalid message.", false, "execute"));
    timer = setTimeout(() => finish(fault("EXECUTOR_READY_TIMEOUT", "Code executor did not become ready.", true, "execute")), EXECUTOR_READY_MS);
  });
}

async function executeTool(payload, key) {
  const source = requireCatalog();
  const { scope, indices } = scopedRecords(source, payload);
  if (scope.subscriptions.size === 0) return { result: "[]", observedIds: [], count: 0 };
  const observed = indices.map((i) => source.records[i]);
  let executor;
  try {
    executor = new Worker(new URL("./catalog-executor.js", import.meta.url), { type: "module" });
    const code = typeof payload?.code === "string" ? payload.code : "";
    executors.set(key, { executor, cancel: null });
    const pending = waitForExecutor(executor, code, (cancel) => {
      const active = executors.get(key);
      if (active) active.cancel = cancel;
    });
    executor.postMessage({
      type: "init",
      projectionJson: JSON.stringify({
        records: observed.map((record) => projection(record, scope)),
        meta: {
          count: observed.length,
          region: source.meta.region || null,
          builtAt: source.meta.built_at || null,
          richIndexReady: Boolean(richCatalog)
        },
        fields: PROJECTION_KEYS,
        sample: observed.slice(0, 3).map((record) => projection(record, scope)),
        context: {
          subscriptions: [...scope.subscriptions]
        }
      })
    });
    const result = await pending;
    if (isCancelled(key)) {
      throw fault("EXECUTOR_CANCELLED", "Code execution was cancelled.", true, "execute");
    }
    const ids = Array.isArray(result?.observedIds) ? result.observedIds : [];
    const allowed = new Set(observed.map((record) => record.id));
    const observedIds = [];
    for (const id of ids) {
      if (typeof id === "string" && allowed.has(id) && !observedIds.includes(id)) observedIds.push(id);
    }
    if (typeof result?.json !== "string") {
      throw fault("OUTPUT_NOT_JSON", "Catalog code did not return serializable JSON.", false, "execute");
    }
    return { result: result.json, observedIds, count: observedIds.length };
  } finally {
    executors.delete(key);
    if (executor) executor.terminate();
  }
}

async function dispatch(op, payload, epoch, id) {
  if (op === "initialize") {
    await loadCatalog(epoch);
    return { state: richCatalog ? "READY_RICH" : "READY_BASIC" };
  }
  if (op === "describe") return describe(payload);
  if (op === "keywordSearch") return keywordSearch(payload);
  if (op === "resolve") return resolve(payload);
  if (op === "seedQueue") return seedQueue(payload);
  if (op === "tool.execute") return executeTool(payload, requestKey(epoch, id));
  throw fault("UNKNOWN_OPERATION", "Unknown catalog operation.", false, "request");
}

self.onmessage = async ({ data }) => {
  if (!data || data.v !== V || !Number.isInteger(data.epoch) || !Number.isInteger(data.id)) return;
  const key = requestKey(data.epoch, data.id);
  if (data.type === "cancel") {
    rememberCancelled(key);
    const active = executors.get(key);
    if (active) {
      active.cancel?.();
      active.executor?.terminate();
    }
    return;
  }
  if (data.type !== "request") return;
  if (data.epoch < currentEpoch) return;
  currentEpoch = data.epoch;
  try {
    const value = await dispatch(data.op, data.payload || {}, data.epoch, data.id);
    if (!isCancelled(key)) respond(data.epoch, data.id, value);
  } catch (error) {
    if (isCancelled(key)) return;
    reject(data.epoch, data.id, error && error.code
      ? error
      : fault("INTERNAL_ERROR", "Catalog operation failed.", false, "catalog"));
  } finally {
    cancelled.delete(key);
  }
};
