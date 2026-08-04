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
  "attribution",
  "catalog-detail",
  "language-select",
  "genre-select",
  "provider-select"
];

const KEYWORD_NOTE = "Keyword search — add an API key in Settings for ranked recommendations.";
const NO_PICKS_NOTE = "Run a search first — there is nothing to export yet.";

const PROVIDER_LABELS = {
  netflix: "Netflix",
  prime: "Prime Video",
  hotstar: "JioHotstar",
  zee5: "ZEE5",
  sonyliv: "SonyLIV",
  mubi: "MUBI",
  crunchyroll: "Crunchyroll",
  sunnxt: "Sun NXT",
  mxplayer: "MX Player",
  discovery: "Discovery+",
  shemaroo: "ShemarooMe",
  lionsgate: "Lionsgate Play",
  manoramamax: "ManoramaMAX",
  hungama: "Hungama Play",
  hoichoi: "Hoichoi",
  aha: "aha",
  curiosity: "CuriosityStream",
  appletv: "Apple TV+",
  epicon: "EPIC ON",
  tataplay: "Tata Play",
  plex: "Plex",
  tubi: "Tubi",
  docubay: "DocuBay",
  bbcplayer: "BBC Player",
  chaupal: "Chaupal",
  erosnow: "Eros Now"
};

const LANGUAGE_NAMES = {
  en: "English",
  hi: "Hindi",
  ta: "Tamil",
  te: "Telugu",
  ml: "Malayalam",
  kn: "Kannada",
  bn: "Bengali",
  mr: "Marathi",
  pa: "Punjabi",
  gu: "Gujarati",
  ur: "Urdu",
  as: "Assamese",
  or: "Odia",
  sa: "Sanskrit",
  ne: "Nepali",
  si: "Sinhala",
  bh: "Bhojpuri",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese",
  fr: "French",
  de: "German",
  es: "Spanish",
  it: "Italian",
  pt: "Portuguese",
  ru: "Russian",
  ar: "Arabic",
  th: "Thai",
  id: "Indonesian",
  tr: "Turkish"
};

let el = null;
let traceBody = null;
let noteEl = null;

let prompts = null;
let records = [];
let recordsById = new Map();
let catalogMeta = null;
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
  return PROVIDER_LABELS[s] || s;
}

function languageLabel(code) {
  const c = String(code || "");
  return LANGUAGE_NAMES[c] || c;
}

function titleInitials(title) {
  const words = String(title || "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0].charAt(0);
  const second = words.length > 1 ? words[1].charAt(0) : "";
  return (first + second).toUpperCase();
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
  const fallback = document.createElement("div");
  fallback.className = "poster-fallback";
  fallback.textContent = titleInitials(pick.t || pick.id);
  return fallback;
}

function metaLine(pick) {
  const parts = [];
  if (pick.y !== null && pick.y !== undefined) parts.push(String(pick.y));
  if (pick.k) parts.push(pick.k);
  if (pick.rt !== null && pick.rt !== undefined) parts.push(pick.rt + " min");
  if (pick.r !== null && pick.r !== undefined) parts.push("TMDB " + pick.r);
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

function scheduleSidecar() {
  const file = catalogMeta && catalogMeta.text_file ? String(catalogMeta.text_file) : "catalog.text.json";
  const run = async () => {
    try {
      const doc = await fetchJson("./assets/" + file);
      const map = doc && typeof doc === "object" ? doc.s : null;
      if (!map || typeof map !== "object") return;
      let merged = 0;
      for (const rec of records) {
        const s = map[rec.id];
        if (typeof s === "string" && s !== "") {
          rec.s = s;
          merged += 1;
        }
      }
      if (merged > 0) scheduleIndex();
    } catch (err) {
      console.warn("ui: synopsis sidecar unavailable, continuing without synopses.", err && err.message ? err.message : err);
    }
  };
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(() => { run(); });
  } else {
    setTimeout(() => { run(); }, 0);
  }
}

function facetFilters() {
  const f = {};
  if (el.providerSelect.value) f.provider = el.providerSelect.value;
  if (el.languageSelect.value) f.lang = el.languageSelect.value;
  if (el.genreSelect.value) f.genre = el.genreSelect.value;
  return f;
}

function makeTools(seenKeys) {
  const facets = facetFilters();
  return createTools({
    records,
    index,
    search,
    filterIndices: (recs, filters) => filterIndices(recs, { ...(filters || {}), ...facets }),
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
    l: full.l,
    g: full.g,
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
  if (controller) return;
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
    el.sendBtn.disabled = true;
    el.queryInput.disabled = true;
    try {
      await runKeywordFallback(query, tools, seenKeys);
    } catch (err) {
      showError(err && err.message ? err.message : "Keyword search failed.");
    } finally {
      el.sendBtn.disabled = false;
      el.queryInput.disabled = false;
    }
    return;
  }

  controller = new AbortController();
  el.stopBtn.hidden = false;
  el.sendBtn.hidden = true;
  el.sendBtn.disabled = true;
  el.queryInput.disabled = true;
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
    el.sendBtn.disabled = false;
    el.queryInput.disabled = false;
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

function fillSelect(select, values, labelFor, placeholderText) {
  if (select.options.length === 0) {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = placeholderText;
    select.appendChild(placeholder);
  }
  while (select.options.length > 1) select.remove(1);
  for (const value of values) {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = labelFor(value);
    select.appendChild(option);
  }
}

function populateFacets(meta) {
  const m = meta || {};
  const providerOrder = Array.isArray(m.provider_order) ? m.provider_order : [];
  fillSelect(el.providerSelect, providerOrder, providerLabel, "All providers");
  const languages = Array.isArray(m.languages) ? m.languages : [];
  fillSelect(el.languageSelect, languages, languageLabel, "All languages");
  const genres = Array.isArray(m.genres) ? m.genres : [];
  fillSelect(el.genreSelect, genres, (name) => String(name), "All genres");
}

function fillCatalogDetail(meta) {
  const m = meta || {};
  const parts = [];
  if (m.source) parts.push("Source: " + m.source);
  if (m.region) parts.push("Region: " + String(m.region).toUpperCase());
  const builtAt = String(m.built_at || "").slice(0, 10);
  if (builtAt) parts.push("Built " + builtAt);
  el.catalogDetail.textContent = parts.join(" · ");
  el.catalogDetail.hidden = parts.length === 0;
}

function wireFacets() {
  const rerun = () => {
    if (!index || !lastQuery || controller) return;
    el.queryInput.value = lastQuery;
    el.queryForm.requestSubmit();
  };
  el.providerSelect.addEventListener("change", rerun);
  el.languageSelect.addEventListener("change", rerun);
  el.genreSelect.addEventListener("change", rerun);
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
  catalogMeta = meta;
  const count = typeof meta.count === "number" ? meta.count : records.length;
  const builtAt = String(meta.built_at || "").slice(0, 10);
  el.catalogStatus.textContent = count.toLocaleString("en-IN") + " titles · snapshot " + builtAt;
  populateFacets(meta);
  fillCatalogDetail(meta);
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
    wireFacets();
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
    scheduleSidecar();
  } catch (err) {
    showError(err && err.message ? err.message : String(err));
  }
}

init();
