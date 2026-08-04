import { normalizeTitle, buildIndex, search, filterIndices } from "./catalog.js";
import { parseNetflixCsv, summarize } from "./history.js";
import { createTools } from "./tools.js";
import { runAgent } from "./agent.js";
import { createStore } from "./store.js";
import { toMarkdown, toJson, toCsv, toYouMd } from "./exporters.js";

const store = createStore(window.localStorage);

const DOM_IDS = [
  "app",
  "catalog-status",
  "query-form",
  "query-input",
  "send-btn",
  "stop-btn",
  "mood-select",
  "results",
  "trace",
  "settings-btn",
  "settings-dialog",
  "llm-base-url",
  "llm-api-key",
  "llm-model",
  "settings-save",
  "settings-close",
  "context-btn",
  "context-dialog",
  "youmd-input",
  "history-file",
  "history-summary",
  "context-save",
  "context-close",
  "export-md",
  "export-json",
  "export-csv",
  "export-youmd",
  "error-banner",
  "attribution"
];

const KEYWORD_NOTE = "Keyword search — add an API key in Settings for ranked recommendations.";
const NO_PICKS_NOTE = "Run a search first — there is nothing to export yet.";

let el = null;
let traceBody = null;
let noteEl = null;

let prompts = null;
let records = [];
let recordsById = new Map();
let index = null;

let parsedHistory = null;
let controller = null;
let lastPicks = [];
let lastQuery = "";

function camelize(id) {
  return id.replace(/-([a-z])/g, (match, letter) => letter.toUpperCase());
}

function collectDom() {
  const found = {};
  const missing = [];
  for (const id of DOM_IDS) {
    const node = document.getElementById(id);
    if (!node) missing.push(id);
    found[camelize(id)] = node;
  }
  if (missing.length > 0) {
    for (const id of missing) console.error("ui: missing required element id \"" + id + "\"");
    return null;
  }
  return found;
}

function showError(message) {
  el.errorBanner.textContent = message;
  el.errorBanner.hidden = false;
}

function clearError() {
  el.errorBanner.textContent = "";
  el.errorBanner.hidden = true;
}

function setNote(text) {
  const value = typeof text === "string" ? text.trim() : "";
  noteEl.textContent = value;
  noteEl.hidden = value === "";
}

function clearTrace() {
  traceBody.textContent = "";
}

function appendTrace(text) {
  const line = document.createElement("div");
  line.className = "trace-line";
  line.textContent = text;
  traceBody.appendChild(line);
  if (traceBody.childElementCount === 1) el.trace.open = true;
}

function compactArgs(args) {
  try {
    return JSON.stringify(args ?? {});
  } catch (err) {
    return "{}";
  }
}

function providerLabel(slug) {
  const s = String(slug || "");
  if (!s) return "Watch";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function buildPoster(pick) {
  if (pick.img) {
    const img = document.createElement("img");
    img.className = "card-poster";
    img.src = pick.img;
    img.loading = "lazy";
    img.alt = "";
    return img;
  }
  const placeholder = document.createElement("div");
  placeholder.className = "card-poster";
  return placeholder;
}

function metaLine(pick) {
  const parts = [];
  if (pick.y !== null && pick.y !== undefined) parts.push(String(pick.y));
  if (pick.k) parts.push(pick.k);
  if (pick.rt !== null && pick.rt !== undefined) parts.push(pick.rt + " min");
  if (pick.r !== null && pick.r !== undefined) parts.push("IMDb " + pick.r);
  if (parts.length === 0) return null;
  const p = document.createElement("p");
  p.className = "card-meta";
  p.textContent = parts.join(" · ");
  return p;
}

function linkRow(pick) {
  const u = pick.u;
  if (!u || typeof u !== "object") return null;
  const slugs = Object.keys(u).filter((slug) => u[slug]);
  if (slugs.length === 0) return null;
  const row = document.createElement("div");
  row.className = "card-links";
  for (const slug of slugs) {
    const a = document.createElement("a");
    a.href = u[slug];
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = "Watch on " + providerLabel(slug);
    row.appendChild(a);
  }
  return row;
}

function buildCard(pick) {
  const card = document.createElement("article");
  card.className = "card";
  card.appendChild(buildPoster(pick));

  const body = document.createElement("div");
  body.className = "card-body";

  const title = document.createElement("h3");
  title.className = "card-title";
  title.textContent = pick.t || pick.id || "Untitled";
  body.appendChild(title);

  const meta = metaLine(pick);
  if (meta) body.appendChild(meta);

  if (typeof pick.reason === "string" && pick.reason.trim() !== "") {
    const reason = document.createElement("p");
    reason.className = "card-reason";
    reason.textContent = pick.reason;
    body.appendChild(reason);
  }

  const links = linkRow(pick);
  if (links) body.appendChild(links);

  card.appendChild(body);
  return card;
}

function renderPicks(picks) {
  const list = Array.isArray(picks) ? picks : [];
  lastPicks = list;
  el.results.textContent = "";
  if (list.length === 0) {
    const empty = document.createElement("p");
    empty.className = "note";
    empty.textContent = (prompts && prompts.no_results) || "No matches in this catalog snapshot.";
    el.results.appendChild(empty);
    return;
  }
  for (const pick of list) el.results.appendChild(buildCard(pick));
}

function download(filename, mime, text) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportMeta() {
  return { query: lastQuery, generatedAt: new Date().toISOString() };
}

function hasPicks() {
  if (lastPicks.length > 0) return true;
  setNote(NO_PICKS_NOTE);
  return false;
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error("Request for " + url + " failed with status " + res.status + ".");
  return await res.json();
}

function scheduleIndex() {
  const run = () => {
    try {
      index = buildIndex(records);
      el.sendBtn.disabled = false;
    } catch (err) {
      showError("Could not prepare the search index. " + (err && err.message ? err.message : ""));
    }
  };
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(run);
  } else {
    setTimeout(run, 0);
  }
}

function makeTools(seenKeys) {
  return createTools({
    records,
    index,
    search,
    filterIndices,
    normalizeTitle,
    seenKeys
  });
}

function hydrate(row) {
  const full = recordsById.get(row.id);
  if (!full) return { ...row, u: null, img: null, reason: "" };
  return {
    id: full.id,
    t: full.t,
    y: full.y,
    k: full.k,
    rt: full.rt,
    r: full.r,
    p: full.p,
    u: full.u,
    img: full.img,
    reason: ""
  };
}

async function runKeywordFallback(query, tools, seenKeys) {
  const result = await tools.handlers.search_titles({
    query,
    exclude_seen: seenKeys.length > 0,
    limit: 20
  });
  renderPicks((result.results || []).map(hydrate));
  setNote(KEYWORD_NOTE);
}

function makeEventHandler() {
  return function onEvent(event) {
    if (!event || typeof event !== "object") return;
    if (event.type === "status") {
      appendTrace(event.text || "");
      return;
    }
    if (event.type === "tool_call") {
      appendTrace(event.name + " " + compactArgs(event.args));
      return;
    }
    if (event.type === "tool_result") {
      appendTrace(event.name + " → " + (event.count ?? 0) + " results");
      return;
    }
    if (event.type === "delta") {
      setNote(event.text || "");
      return;
    }
    if (event.type === "done") {
      renderPicks(event.picks);
      return;
    }
    if (event.type === "error") {
      showError(event.message || "Something went wrong.");
    }
  };
}

async function onSubmit(event) {
  event.preventDefault();
  const query = String(el.queryInput.value || "").trim();
  if (!query) return;
  if (!index) {
    setNote("Still preparing the catalog — try again in a moment.");
    return;
  }

  clearError();
  lastQuery = query;

  const seenKeys = store.getHistory()?.seen ?? [];
  const tools = makeTools(seenKeys);

  if (!store.hasKey()) {
    try {
      await runKeywordFallback(query, tools, seenKeys);
    } catch (err) {
      showError(err && err.message ? err.message : "Keyword search failed.");
    }
    return;
  }

  controller = new AbortController();
  el.stopBtn.hidden = false;
  el.sendBtn.hidden = true;
  el.results.textContent = "";
  clearTrace();
  setNote("");

  try {
    await runAgent({
      config: store.getLlm(),
      prompts,
      tools,
      context: {
        youmd: store.getYouMd(),
        history: store.getHistory(),
        mood: el.moodSelect.value
      },
      query,
      onEvent: makeEventHandler(),
      signal: controller.signal
    });
  } catch (err) {
    showError(err && err.message ? err.message : "The search failed.");
  } finally {
    el.stopBtn.hidden = true;
    el.sendBtn.hidden = false;
    controller = null;
  }
}

function readHistoryFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = parseNetflixCsv(String(reader.result || ""));
      parsedHistory = parsed;
      el.historySummary.textContent = summarize(parsed);
    } catch (err) {
      parsedHistory = null;
      el.historySummary.textContent = err && err.message ? err.message : "Could not read that CSV.";
    }
  };
  reader.onerror = () => {
    parsedHistory = null;
    el.historySummary.textContent = "Could not read that file.";
  };
  reader.readAsText(file);
}

function wireSettings() {
  el.settingsBtn.addEventListener("click", () => {
    const llm = store.getLlm();
    el.llmBaseUrl.value = llm.baseUrl || "";
    el.llmApiKey.value = llm.apiKey || "";
    el.llmModel.value = llm.model || "";
    el.settingsDialog.showModal();
  });

  el.settingsSave.addEventListener("click", () => {
    store.setLlm({
      baseUrl: el.llmBaseUrl.value.trim(),
      apiKey: el.llmApiKey.value.trim(),
      model: el.llmModel.value.trim()
    });
    el.settingsDialog.close();
  });

  el.settingsClose.addEventListener("click", () => {
    el.settingsDialog.close();
  });
}

function wireContext() {
  el.contextBtn.addEventListener("click", () => {
    el.youmdInput.value = store.getYouMd();
    el.contextDialog.showModal();
  });

  el.historyFile.addEventListener("change", () => {
    const file = el.historyFile.files && el.historyFile.files[0];
    if (!file) return;
    try {
      readHistoryFile(file);
    } catch (err) {
      parsedHistory = null;
      el.historySummary.textContent = err && err.message ? err.message : "Could not read that file.";
    }
  });

  el.contextSave.addEventListener("click", () => {
    store.setYouMd(el.youmdInput.value);
    store.setHistory(parsedHistory ?? store.getHistory());
    el.contextDialog.close();
  });

  el.contextClose.addEventListener("click", () => {
    el.contextDialog.close();
  });
}

function wireExports() {
  el.exportMd.addEventListener("click", () => {
    if (!hasPicks()) return;
    download("watch-picks.md", "text/markdown;charset=utf-8", toMarkdown(lastPicks, exportMeta()));
  });

  el.exportJson.addEventListener("click", () => {
    if (!hasPicks()) return;
    download("watch-picks.json", "application/json;charset=utf-8", toJson(lastPicks, exportMeta()));
  });

  el.exportCsv.addEventListener("click", () => {
    if (!hasPicks()) return;
    download("watch-picks.csv", "text/csv;charset=utf-8", toCsv(lastPicks, exportMeta()));
  });

  el.exportYoumd.addEventListener("click", () => {
    download("You.md", "text/markdown;charset=utf-8", toYouMd(store.getYouMd(), store.getHistory()));
  });
}

async function loadData() {
  el.catalogStatus.textContent = "Loading catalog…";
  const [promptsDoc, catalogDoc] = await Promise.all([
    fetchJson("./assets/prompts.json"),
    fetchJson("./assets/catalog.json")
  ]);

  prompts = promptsDoc;
  records = Array.isArray(catalogDoc.records) ? catalogDoc.records : [];
  recordsById = new Map();
  for (const rec of records) recordsById.set(rec.id, rec);

  const meta = catalogDoc.meta || {};
  const count = typeof meta.count === "number" ? meta.count : records.length;
  const builtAt = String(meta.built_at || "").slice(0, 10);
  el.catalogStatus.textContent = count.toLocaleString("en-IN") + " titles · snapshot " + builtAt;
}

async function init() {
  el = collectDom();
  if (!el) return;

  traceBody = el.trace.querySelector("div");
  if (!traceBody) {
    console.error("ui: #trace is missing its inner container");
    return;
  }

  noteEl = document.createElement("p");
  noteEl.className = "note";
  noteEl.hidden = true;
  el.results.parentNode.insertBefore(noteEl, el.results);

  try {
    clearError();
    el.sendBtn.disabled = true;
    el.stopBtn.hidden = true;

    wireSettings();
    wireContext();
    wireExports();
    el.queryForm.addEventListener("submit", onSubmit);
    el.stopBtn.addEventListener("click", () => {
      if (controller) controller.abort();
    });

    try {
      await loadData();
    } catch (err) {
      el.catalogStatus.textContent = "Catalog unavailable.";
      showError("Could not load the catalog.");
      return;
    }

    scheduleIndex();
  } catch (err) {
    showError(err && err.message ? err.message : String(err));
  }
}

init();
