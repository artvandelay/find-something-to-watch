import { normalizeTitle, seedQueue } from "./catalog.js";
import { historyImportReply, parseWatchHistoryExport, resolveHistoryWithCatalog, summarize } from "./history.js";
import { parseChatCommand, regionCommandReply, subscriptionCommandReply } from "./chat-commands.js";
import { createHistoryPlanInferer } from "./history-model.js";
import { createTools } from "./tools.js";
import { runAgent } from "./agent.js";
import { createCatalogRuntime } from "./catalog-runtime.js";
import { createStore, DEFAULT_LLM } from "./store.js";
import { createBrowserMemory, rememberMark } from "./memory.js";
import { generateConversationTitle } from "./conversation-title.js";
import {
  DEFAULT_RECOMMENDATION_REASON,
  allowsRewatch,
  RECOMMENDATION_LIMITS,
  normalizeQueueMode,
  defaultRecommendationQueue,
  sanitizeRecommendationQueue,
  isUsefulReason
} from "./recommendations.js";
import { mergeLearnedPreferences, renderLearnedContext, upsertLearnedPreference } from "./preferences.js";
import { nextRecommendedOpenRouterModel } from "./openrouter-models.js";
import { needsEnrichment, runEnricher } from "./enricher.js";
import { providerLabel, watchCta, intersectProviders, DEFAULT_PROVIDER_ORDER, DEFAULT_REGION, FREE_PROVIDER_SLUGS, mergeFreeRecords, dailyFreePick } from "./providers.js";
import { WELCOME_GAP_MS, buildTemporalBlock, buildRecapBlock, buildDividers, buildWelcome, buildMemoryLine } from "./tonight.js";
import {
  addToPlaylist,
  createPlaylist,
  deletePlaylist,
  playlistFilename,
  removeFromPlaylist,
  renamePlaylist
} from "./playlists.js";
import { toMarkdown, toJson, toCsv } from "./exporters.js";
import { createOnboardingView } from "./views/onboarding.js";
import { createPaneLayoutView } from "./views/panes.js";
import { createSidebarView } from "./views/sidebar.js";
import { createChatView } from "./views/chat.js";
import { createQueueView } from "./views/queue.js";
import { createDialogs, renderLearnedFacts } from "./views/dialogs.js";
import { createPlaylistsView } from "./views/playlists.js";
import { createTitleDetailsView } from "./views/title-details.js";
import { downloadText } from "./views/dom.js";
import { readTestMode } from "./test-mode.js";

const store = createStore(window.localStorage);
const memory = createBrowserMemory({
  onIssue: (issue) => console.warn("ui: browser-memory issue", issue),
  now: () => new Date(Date.now())
});

// Keep onboarding available while the app opens directly into chat. Set this
// to false to restore the profile-based first-run flow.
const BYPASS_ONBOARDING = true;

const DOM_IDS = [
  "app", "error-banner",
  "onboarding-screen", "onboarding-form", "onboarding-provider-list",
  "onboarding-title", "onboarding-progress", "onboarding-llm-api-key",
  "onboarding-region-select",
  "onboarding-back", "onboarding-next",
  "shell", "sidebar-toggle", "sidebar", "sidebar-collapse", "sidebar-collapse-icon", "backdrop", "new-chat-btn",
  "conversation-list", "conversation-list-items", "subscriptions-summary", "subscriptions-edit",
  "playlists-btn", "context-btn", "settings-btn", "catalog-status",
  "workspace", "chat-region", "chat-transcript", "chat-key-error", "chat-note",
  "query-form", "query-input", "chat-file", "send-btn", "stop-btn",
  "pane-separator", "queue-region", "queue-collapse", "queue-restore",
  "queue-status", "queue-feedback", "queue-source", "queue-viewport", "queue-track", "queue-empty",
  "queue-top-pick", "queue-alternatives", "queue-more",
  "title-details-dialog", "title-details-close", "title-details-title", "title-details-content",
  "attribution",
  "settings-dialog", "settings-provider-list", "llm-base-url", "llm-api-key",
  "llm-model-picker", "llm-model-picker-label", "llm-model-trigger",
  "llm-model-trigger-name", "llm-model-trigger-meta", "llm-model-panel",
  "llm-model-search", "llm-model-list", "llm-model-detail", "llm-model-other",
  "llm-model-custom", "llm-model-note", "llm-model-openrouter-field",
  "llm-model-compat-field", "llm-model",
  "llm-web-search", "region-select", "export-backup-btn", "reset-keep-key-btn", "clear-data-btn",
  "memory-dialog", "memory-facts", "memory-marks", "memory-imports", "memory-import-remove", "memory-enrich-btn", "memory-close",
  "settings-feedback", "settings-save", "settings-close",
  "context-dialog", "youmd-input", "history-summary", "history-remove", "context-enrich-btn", "context-enrich-status",
  "memory-enabled", "learned-facts", "learned-clear", "context-feedback", "context-save", "context-close",
  "disclosure-dialog", "catalog-detail", "trace",
  "export-md", "export-json", "export-csv", "export-youmd", "disclosure-feedback",
  "disclosure-close",
  "playlists-dialog", "playlists-dialog-title", "playlist-back", "playlists-close",
  "playlist-picker", "playlist-picker-title", "playlist-picker-list",
  "playlist-library", "playlist-library-list", "playlist-library-empty", "playlist-new",
  "playlist-detail", "playlist-detail-count", "playlist-items",
  "playlist-more", "playlist-actions", "playlist-rename", "playlist-delete",
  "playlist-export", "playlist-export-formats", "playlist-export-md", "playlist-export-json",
  "playlist-export-csv",
  "playlist-rename-form", "playlist-rename-name", "playlist-rename-save",
  "playlist-rename-cancel",
  "playlist-create-view", "playlist-create-name", "playlist-create",
  "playlist-feedback"
];

let el = null;
let dialogs = null;
let sidebar = null;
let chat = null;
let queueView = null;
let onboarding = null;
let playlistsView = null;
let titleDetailsView = null;

let prompts = null;
let records = [];
let recordsById = new Map();
let catalogMeta = null;
let catalogProviderOrder = null;
let displayCatalogReady = false;
let richIndexReady = false;
let catalogRuntimeState = "BOOTING";
let catalogRuntimeError = null;
let cachedCatalogManifest = null;
let cachedCatalogManifestKey = null;

let profile = null;
let subscriptions = new Set();
let paidCount = 0;
let freeCount = 0;
let paidRecords = [];
let freeDoc = null;
const scopeProviders = () => new Set([...subscriptions, ...FREE_PROVIDER_SLUGS]);
let conversation = null;
let recommendationQueue = defaultRecommendationQueue();
let learned = null;
let playlists = null;
let seenKeysCache = [];
let historyCache = null;

let controller = null;
let localExchange = false;
let historyController = null;
let stateGeneration = 0;
let activeTurnId = null;
let activePendingUser = null;

const MAX_TIMING_PHASES = 24;
const AGENT_TIMING_PHASES = new Set(["model_request", "catalog_tool"]);

function createTurnTiming(turnId) {
  const perf = window.performance;
  const origin = typeof perf?.now === "function" ? perf.now() : Date.now();
  const phases = [];
  let droppedPhases = 0;
  let firstVisibleTokenMs = null;
  let sequence = 0;
  const now = () => typeof perf?.now === "function" ? perf.now() : Date.now();
  const mark = (name) => {
    const id = `turn:${turnId}:${sequence++}:${name}`;
    try {
      perf?.mark?.(id);
    } catch {
      // Timing must remain optional when Performance APIs are unavailable.
    }
    return id;
  };
  const add = (name, atMs = now() - origin, durationMs = 0) => {
    if (phases.length >= MAX_TIMING_PHASES) {
      droppedPhases += 1;
      return;
    }
    phases.push({
      name,
      atMs: Math.max(0, Math.round(atMs)),
      durationMs: Math.max(0, Math.round(durationMs)),
      order: sequence++
    });
  };
  const submitMark = mark("submit");
  add("submit", 0);
  return {
    elapsed: () => Math.max(0, now() - origin),
    start(name) {
      return { name, atMs: now() - origin, mark: mark(name + ":start") };
    },
    end(entry) {
      const endMark = mark(entry.name + ":end");
      let durationMs = Math.max(0, now() - origin - entry.atMs);
      try {
        const measureName = `turn:${turnId}:${sequence++}:${entry.name}:duration`;
        perf?.measure?.(measureName, entry.mark, endMark);
        const measured = perf?.getEntriesByName?.(measureName).at(-1)?.duration;
        if (Number.isFinite(measured)) durationMs = measured;
        perf?.clearMeasures?.(measureName);
      } catch {
        // Keep the fallback duration when measure() cannot run.
      } finally {
        try {
          perf?.clearMarks?.(entry.mark);
          perf?.clearMarks?.(endMark);
        } catch {
          // Performance buffers are best effort only.
        }
      }
      add(entry.name, entry.atMs, durationMs);
    },
    point(name) {
      const atMs = now() - origin;
      const pointMark = mark(name);
      try {
        perf?.clearMarks?.(pointMark);
      } catch {
        // Performance buffers are best effort only.
      }
      add(name, atMs);
      if (name === "first_visible_token" && firstVisibleTokenMs === null) {
        firstVisibleTokenMs = Math.max(0, Math.round(atMs));
      }
    },
    mergeAgent(timing, agentStartedAt) {
      for (const phase of Array.isArray(timing?.phases) ? timing.phases : []) {
        if (!AGENT_TIMING_PHASES.has(phase?.name) || !Number.isFinite(phase.atMs) ||
          !Number.isFinite(phase.durationMs)) continue;
        add(
          phase.name,
          agentStartedAt + Math.max(0, phase.atMs),
          Math.max(0, phase.durationMs)
        );
      }
      if (Number.isFinite(timing?.droppedPhases) && timing.droppedPhases > 0) {
        droppedPhases += Math.floor(timing.droppedPhases);
      }
    },
    finish() {
      const completeMark = mark("complete_turn");
      try {
        perf?.clearMarks?.(completeMark);
      } catch {
        // Performance buffers are best effort only.
      }
      add("complete_turn");
      try {
        perf?.clearMarks?.(submitMark);
      } catch {
        // Performance buffers are best effort only.
      }
      const totalMs = Math.max(0, Math.round(now() - origin));
      return {
        totalMs,
        firstTokenMs: firstVisibleTokenMs,
        phases: phases
          .sort((left, right) => left.atMs - right.atMs || left.order - right.order)
          .map(({ name, atMs, durationMs }) => ({ name, atMs, durationMs })),
        droppedPhases
      };
    }
  };
}

const runtime = createCatalogRuntime({
  onState(nextState) {
    catalogRuntimeState = nextState;
    if (nextState === "BOOTING" || nextState === "RESTARTING") {
      invalidateCatalogManifestCache();
    }
    if (nextState === "READY_BASIC" || nextState === "READY_RICH") {
      catalogRuntimeError = null;
    }
    if (queueView) updateCatalogStatusLine();
  }
});

function camelize(id) {
  return id.replace(/-([a-z])/g, (m, letter) => letter.toUpperCase());
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

async function fetchJson(url) {
  // Static catalog assets are versioned by deploy; keep normal HTTP cache semantics
  // so warm loads reuse transfer instead of forcing a full re-download.
  const res = await fetch(url, { cache: "default" });
  if (!res.ok) throw new Error("Request for " + url + " failed with status " + res.status + ".");
  return await res.json();
}

function providerOrder() {
  // The worker manifest narrows provider_order to the current subscriptions.
  // The picker needs the full catalog order captured at load, or a saved
  // Netflix subscription would be the only checkbox.
  return catalogProviderOrder && catalogProviderOrder.length > 0
    ? catalogProviderOrder
    : DEFAULT_PROVIDER_ORDER;
}

function cancelActiveHistoryImport() {
  if (historyController) historyController.abort();
  historyController = null;
}

async function importHistoryFile(file, { signal = null } = {}) {
  if (!file || typeof file.arrayBuffer !== "function") {
    throw new Error("Could not read that watch-history file.");
  }

  cancelActiveHistoryImport();
  const activeController = new AbortController();
  historyController = activeController;
  const abortFromCaller = () => activeController.abort();
  if (signal) {
    if (signal.aborted) activeController.abort();
    else signal.addEventListener("abort", abortFromCaller, { once: true });
  }

  try {
    const bytes = await file.arrayBuffer();
    if (activeController.signal.aborted) {
      const error = new Error("The history import was cancelled.");
      error.name = "AbortError";
      throw error;
    }
    const inferPlan = async (input, options) => {
      if (typeof window.__OTT_TEST_HISTORY_PLAN__ === "function") {
        return window.__OTT_TEST_HISTORY_PLAN__(input, options);
      }
      if (!store.hasKey()) {
        throw new Error("An OpenRouter API key is required to read this file. Add the key in Settings.");
      }
      if (!prompts || typeof prompts.history_plan !== "string") {
        throw new Error("The history import prompt is unavailable.");
      }
      const infer = createHistoryPlanInferer({
        config: store.getLlm(),
        prompt: prompts.history_plan
      });
      return infer(input, options);
    };
    return await parseWatchHistoryExport(
      { name: file.name, bytes },
      { inferPlan, signal: activeController.signal }
    );
  } finally {
    if (signal) signal.removeEventListener("abort", abortFromCaller);
    if (historyController === activeController) historyController = null;
  }
}

// ---- Catalog + search index readiness -------------------------------------

function updateCatalogStatusLine() {
  const count = paidCount > 0
    ? paidCount
    : (typeof (catalogMeta && catalogMeta.count) === "number" ? catalogMeta.count : records.length);
  const builtAt = String((catalogMeta && catalogMeta.built_at) || "").slice(0, 10);
  let line = count.toLocaleString("en-IN") + " titles";
  if (freeCount > 0) line += " + " + freeCount.toLocaleString("en-IN") + " free to watch or listen";
  if (builtAt) line += " · snapshot " + builtAt;
  line += " · availability may have changed";
  if (!displayCatalogReady) line += " · preparing catalog…";
  else if (!richIndexReady) line += " · refining with synopses…";
  if (catalogRuntimeError) line += " · catalog analysis unavailable";
  queueView.setCatalogStatus(line);
  if (chat) {
    const runtimeNote = catalogRuntimeError
      ? "Catalog analysis is unavailable. Chat will be available when it recovers."
      : "";
    chat.setNote(runtimeNote || (!richIndexReady
      ? "Catalog analysis is still refining with full synopses — results may be less precise for a moment."
      : ""));
    refreshSendReadiness();
  }
}

function refreshSendReadiness() {
  const hasKey = store.hasKey();
  chat.setKeyAvailable(hasKey);
  chat.setSendReady(hasKey && displayCatalogReady);
}

/**
 * Destructive conversation/profile controls stay locked during a turn.
 * Non-destructive navigation (scroll, collapse, title details) stays available.
 */
function setShellBusy(busy) {
  if (sidebar) sidebar.setBusy(busy);
  if (dialogs) dialogs.setBusy(busy);
  if (queueView) queueView.setBusy(busy);
}

function currentScope() {
  return { subscriptions: [...scopeProviders()] };
}

function catalogManifestCacheKey(scope = currentScope()) {
  const subscriptions = Array.isArray(scope.subscriptions) ? scope.subscriptions : [];
  return (profile?.region || DEFAULT_REGION) + "\0" + subscriptions
    .filter((value) => typeof value === "string" && value)
    .slice()
    .sort()
    .join("\0");
}

function invalidateCatalogManifestCache() {
  cachedCatalogManifest = null;
  cachedCatalogManifestKey = null;
}

async function getCatalogManifest({ signal = null } = {}) {
  if (hasDeterministicAgent()) {
    return { count: records.length, providers: [...scopeProviders()] };
  }
  const key = catalogManifestCacheKey();
  if (cachedCatalogManifest && cachedCatalogManifestKey === key) {
    return cachedCatalogManifest;
  }
  const manifest = await runtime.describe({ scope: currentScope() }, signal);
  if (catalogManifestCacheKey() === key) {
    cachedCatalogManifest = manifest;
    cachedCatalogManifestKey = key;
  }
  return manifest;
}

function runtimeIsReady() {
  return catalogRuntimeState === "READY_BASIC" || catalogRuntimeState === "READY_RICH";
}

function hasDeterministicAgent() {
  return typeof window.__OTT_TEST_RUN_AGENT__ === "function";
}

function runWhenIdle(run) {
  // Sidecar merge is deferred so first paint stays responsive. Browsers may
  // defer idle callbacks indefinitely while a page is busy, so bound the wait.
  if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(run, { timeout: 250 });
  else setTimeout(run, 0);
}

function scheduleSidecar() {
  const file = catalogMeta && catalogMeta.text_file ? String(catalogMeta.text_file) : "catalog.text.json";
  const run = async () => {
    try {
      const doc = await fetchJson("./assets/" + file);
      const map = doc && typeof doc === "object" ? doc.s : null;
      if (map && typeof map === "object") {
        let merged = 0;
        for (const rec of records) {
          const s = map[rec.id];
          if (typeof s === "string" && s !== "") {
            rec.s = s;
            merged += 1;
          }
        }
        // Display projections stay on the main thread; search indexing belongs
        // to the catalog Worker only — do not rebuild a second BM25 index here.
        if (merged > 0) {
          renderQueue();
          titleDetailsView?.refresh();
        }
      }
    } catch (err) {
      console.warn("ui: synopsis sidecar unavailable, continuing without synopses.", err && err.message ? err.message : err);
    } finally {
      richIndexReady = true;
      updateCatalogStatusLine();
    }
  };
  runWhenIdle(() => run());
}

// ---- Hydration / rendering --------------------------------------------------

function seenKeySet(keys = seenKeysCache) {
  return new Set((Array.isArray(keys) ? keys : []).filter((key) => typeof key === "string" && key));
}

function titleIsWatched(title, seen = seenKeySet()) {
  if (seen.size === 0) return false;
  const key = normalizeTitle(title);
  return Boolean(key) && seen.has(key);
}

async function refreshSeenKeys() {
  try {
    historyCache = await memory.getHistory();
    seenKeysCache = [...(historyCache?.seen ?? []), ...(historyCache?.blocked ?? [])];
  } catch {
    historyCache = null;
    seenKeysCache = [];
  }
  return seenKeysCache;
}

function currentRegion() {
  return profile?.region || DEFAULT_REGION;
}

function applyFreeMerge(region = currentRegion()) {
  const merged = mergeFreeRecords(paidRecords, freeDoc, { region });
  records = merged.records;
  freeCount = merged.added;
  recordsById = new Map();
  for (const rec of records) recordsById.set(rec.id, rec);
  displayCatalogReady = records.length > 0;
  invalidateCatalogManifestCache();
}

async function syncRegion(region = currentRegion()) {
  applyFreeMerge(region);
  try {
    await runtime.setRegion(region);
  } catch (err) {
    console.warn("ui: could not update the catalog region.", err && err.message ? err.message : err);
  }
}

function hydrate(id, reason = "", { includeWatched = false } = {}) {
  const full = recordsById.get(id);
  if (!full) return null;
  const scoped = intersectProviders(full, scopeProviders());
  if (scoped.p.length === 0) return null; // no longer available on current subscriptions
  if (!includeWatched && titleIsWatched(scoped.t)) return null;
  return {
    id: scoped.id, t: scoped.t, y: scoped.y, k: scoped.k, rt: scoped.rt, r: scoped.r,
    p: scoped.p, l: scoped.l, g: scoped.g, u: scoped.u, img: scoped.img, s: scoped.s || "",
    reason
  };
}

function filterQueueItems(items, { includeWatched = false } = {}) {
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      const hydrated = hydrate(item.id, item.reason, { includeWatched });
      return hydrated ? { id: hydrated.id, reason: item.reason || "" } : null;
    })
    .filter(Boolean);
}

function resolveTitleDetails(id) {
  const rec = recordsById.get(id);
  const catalog = {
    region: typeof catalogMeta?.region === "string" ? catalogMeta.region : null,
    source: typeof catalogMeta?.source === "string" ? catalogMeta.source : null,
    builtAt: typeof catalogMeta?.built_at === "string" ? catalogMeta.built_at : null
  };
  if (!rec) {
    return { status: "missing", id, title: null, availability: [], catalog };
  }

  const availability = (Array.isArray(rec.p) ? rec.p : []).map((slug) => {
    const url = typeof rec.u?.[slug] === "string" ? rec.u[slug] : null;
    return {
      slug,
      label: providerLabel(slug),
      subscribed: scopeProviders().has(slug),
      url,
      cta: url ? watchCta(slug, url) : null
    };
  });
  return {
    status: "available",
    id,
    title: {
      t: rec.t,
      y: rec.y ?? null,
      k: rec.k,
      rt: rec.rt ?? null,
      s: rec.s || "",
      im: rec.im ?? null,
      r: rec.r ?? null,
      img: rec.img ?? null,
      l: rec.l ?? null,
      g: Array.isArray(rec.g) ? rec.g : [],
      v: rec.v ?? null
    },
    availability,
    catalog
  };
}

function hydratedQueue({ includeWatched = false } = {}) {
  return recommendationQueue.items
    .map((item) => hydrate(item.id, item.reason, { includeWatched }))
    .filter(Boolean);
}

function renderQueue({ revealFrom = null } = {}) {
  const list = hydratedQueue();
  let emptyText = "Still preparing the catalog…";
  if (displayCatalogReady) {
    emptyText = subscriptions.size === 0
      ? "Choose subscriptions in Settings to fill your picks."
      : "Nothing queued for your current subscriptions yet.";
  }
  queueView.render(list, emptyText, recommendationQueue.source, {
    showAll: recommendationQueue.showAll === true,
    revealFrom
  });
}

function renderPlaylists() {
  if (!playlistsView || !playlists) return;
  playlistsView.render({
    ...playlists,
    resolveTitle: (titleId) => hydrate(titleId)
  });
}

async function savePlaylistMutation(mutate) {
  const saved = await memory.setPlaylists(mutate(playlists));
  playlists = saved;
  renderPlaylists();
  return saved;
}

async function onPlaylistToggle(playlistId, titleId, checked) {
  return savePlaylistMutation((state) => checked
    ? addToPlaylist(state, playlistId, titleId)
    : removeFromPlaylist(state, playlistId, titleId));
}

async function onPlaylistExport(format, playlistId) {
  const playlist = playlists?.playlists?.find((item) => item.id === playlistId);
  if (!playlist) throw new Error("That playlist is unavailable.");

  const resolved = playlist.titleIds.map((titleId) => hydrate(titleId));
  const picks = resolved.filter(Boolean);
  const unavailableIds = playlist.titleIds.filter((titleId, index) => !resolved[index]);
  const meta = {
    title: playlist.name,
    generatedAt: new Date().toISOString(),
    playlist: { id: playlist.id, name: playlist.name, titleIds: playlist.titleIds.slice() },
    unavailableIds
  };
  const extension = format === "md" ? "md" : format === "json" ? "json" : "csv";
  const mime = format === "md"
    ? "text/markdown;charset=utf-8"
    : format === "json" ? "application/json;charset=utf-8" : "text/csv;charset=utf-8";
  const content = format === "md"
    ? toMarkdown(picks, meta)
    : format === "json" ? toJson(picks, meta) : toCsv(picks, meta);
  downloadText(playlistFilename(playlist, extension), mime, content);
}

async function persistQueue(nextQueue) {
  recommendationQueue = nextQueue;
  try {
    const saved = await memory.saveConversationAndQueue(conversation, recommendationQueue);
    conversation = saved.conversation;
    recommendationQueue = saved.queue;
  } catch (err) {
    console.warn("ui: could not persist the recommendation queue.", err && err.message ? err.message : err);
  }
  renderQueue();
}

async function seedRecommendationQueue({ force = false } = {}) {
  if (records.length === 0 || subscriptions.size === 0) {
    if (force && recommendationQueue.items.length > 0) {
      await persistQueue(defaultRecommendationQueue());
    } else {
      renderQueue();
    }
    return;
  }
  if (!force && (conversation.messages.length > 0 || recommendationQueue.items.length > 0)) return;

  const seenKeys = await refreshSeenKeys();
  let ids = [];
  // Prefer the Worker seed projection when the catalog host is ready; otherwise
  // use the local display fallback so first paint is never blocked on Worker boot.
  if (runtimeIsReady()) {
    try {
      const cards = await runtime.seedQueue({
        scope: currentScope(),
        excludeKeys: seenKeys,
        limit: 20
      });
      ids = cards.map((card) => card && card.id).filter((id) => typeof id === "string" && id);
    } catch (err) {
      console.warn("ui: worker seed unavailable; using local display fallback.", err && err.message ? err.message : err);
    }
  }
  if (ids.length === 0) {
    ids = seedQueue(records, { providers: scopeProviders(), excludeKeys: seenKeys, limit: 20 });
  }
  // Keep the stored fallback reason for schema compatibility; the picks rail hides filler copy.
  await persistQueue({
    ...defaultRecommendationQueue(),
    items: ids.map((id) => ({ id, reason: DEFAULT_RECOMMENDATION_REASON }))
  });
}

async function seedQueueIfEmpty() {
  await seedRecommendationQueue({ force: false });
}

async function pruneUnavailableAndWatched({ reseedsIfEmpty = true, includeWatched = false } = {}) {
  const nextItems = filterQueueItems(recommendationQueue.items, { includeWatched });
  const changed = nextItems.length !== recommendationQueue.items.length
    || nextItems.some((item, index) => item.id !== recommendationQueue.items[index]?.id);
  if (changed) {
    await persistQueue({
      ...recommendationQueue,
      items: nextItems,
      source: nextItems.length ? recommendationQueue.source : null
    });
  } else {
    renderQueue();
  }
  if (reseedsIfEmpty && recommendationQueue.items.length === 0 && conversation.messages.length === 0) {
    await seedRecommendationQueue({ force: true });
  }
}

function recallTurns(archivedItems, messages) {
  const archived = (Array.isArray(archivedItems) ? archivedItems : [])
    .slice(0, 3)
    .slice()
    .reverse()
    .flatMap((thread) => thread.messages || []);
  const older = (Array.isArray(messages) ? messages : []).slice(0, Math.max(0, messages.length - 6));
  const combined = archived.concat(older);
  const turns = [];
  for (let i = 0; i < combined.length; i += 1) {
    if (combined[i]?.role !== "user") continue;
    const next = combined[i + 1];
    turns.push({ user: combined[i], assistant: next?.role === "assistant" ? next : null });
  }
  return turns.slice(-40);
}

let enriching = false;
let enrichStatusNote = "";

function canEnrichNow() {
  return Boolean(profile?.memoryEnabled !== false && needsEnrichment({ history: historyCache, learned, queue: recommendationQueue }));
}

function syncEnrichControls(status = "") {
  const visible = canEnrichNow();
  dialogs?.syncEnrichState({ visible, busy: enriching, status });
  if (el?.memoryEnrichBtn) {
    el.memoryEnrichBtn.hidden = !visible;
    el.memoryEnrichBtn.disabled = enriching;
  }
}

async function onEnrich() {
  if (enriching) return;
  enriching = true;
  enrichStatusNote = "";
  chat.setEnrichBusy(true);
  chat.setEnrichStatus("Enriching taste profile…");
  syncEnrichControls("Enriching taste profile…");
  try {
    const result = await runEnricher({
      config: store.getLlm(),
      history: historyCache,
      learned,
      queue: recommendationQueue,
      records
    });
    if (result.history) {
      historyCache = result.history;
      await memory.setHistory(result.history);
      if (result.history.titleTags) {
        try {
          await runtime.setTitleTags(result.history.titleTags);
        } catch (err) {
          console.warn("ui: could not forward titleTags to runtime", err);
        }
      }
    }
    if (result.learned) {
      learned = result.learned;
      await memory.setLearned(result.learned);
    }
    const note = "Enriched " + (result.taggedCount || 0) + " titles.";
    enrichStatusNote = note;
    queueView?.setFeedbackNote(note);
    syncEnrichControls(note);
    renderConversation();
  } catch (err) {
    console.error("ui: error enriching profile", err);
    enrichStatusNote = "Could not enrich. Check your connection or API key in Settings, then try again.";
    syncEnrichControls(enrichStatusNote);
    renderConversation();
  } finally {
    enriching = false;
    chat.setEnrichBusy(false);
  }
}

function renderConversation() {
  const now = new Date(Date.now());
  const messages = conversation?.messages || [];
  const picks = messages.map(() => []);
  let shown = 0;
  for (let i = messages.length - 1; i >= 0 && shown < 3; i -= 1) {
    const message = messages[i];
    if (message.role !== "assistant" || !Array.isArray(message.picks) || message.picks.length === 0) continue;
    picks[i] = message.picks
      .map((pick) => hydrate(pick.id, pick.reason))
      .filter(Boolean);
    shown += 1;
  }
  const last = messages.at(-1) || null;
  const lastTs = last ? Date.parse(last.createdAt) : NaN;
  const showWelcome = !last || (last.role === "assistant" && (!Number.isFinite(lastTs) || now.getTime() - lastTs >= WELCOME_GAP_MS));
  let lastPickTitle = null;
  if (showWelcome) {
    for (let i = messages.length - 1; i >= 0 && !lastPickTitle; i -= 1) {
      const pick = Array.isArray(messages[i]?.picks) ? messages[i].picks[0] : null;
      if (pick?.id) lastPickTitle = recordsById.get(pick.id)?.t || null;
    }
  }
  const welcome = showWelcome ? buildWelcome({
    now,
    lastActivityIso: last?.createdAt ?? null,
    lastPickTitle,
    hasMessages: messages.length > 0,
    dailyFree: dailyFreePick(records, now, (rec) => titleIsWatched(rec.t)),
    memoryLine: buildMemoryLine({
      facts: learned?.items || [],
      seenCount: Array.isArray(historyCache?.seen) ? historyCache.seen.length : 0,
      blockedCount: Array.isArray(historyCache?.blocked) ? historyCache.blocked.length : 0
    })
  }) : null;
  if (welcome) {
    welcome.canEnrich = canEnrichNow();
    welcome.enrichStatus = enrichStatusNote;
  }
  chat.renderConversation(messages, {
    welcome,
    dividers: buildDividers(messages, now),
    picks
  });
  syncEnrichControls(enrichStatusNote);
  void refreshConversationList();
}

async function refreshConversationList() {
  try {
    const list = await memory.getConversationList();
    sidebar.renderConversationList(list);
  } catch (error) {
    console.warn("ui: could not render conversations.", error);
  }
}

// ---- Agent tools + submission -----------------------------------------------

function makeTools(seenKeys, currentQueue) {
  return createTools({
    runtime,
    scope: currentScope(),
    currentQueue,
    seenKeys: Array.isArray(seenKeys) ? seenKeys : [],
  });
}

function recommendationQueueContext(queue) {
  const safe = sanitizeRecommendationQueue(queue);
  if (!safe || safe.items.length === 0) return null;
  return {
    source: safe.source,
    items: safe.items.map((item, index) => ({
      id: item.id,
      t: recordsById.get(item.id)?.t || item.id,
      reason: item.reason,
      rank: index === 0 ? "top" : index < 3 ? "alternative" : "more"
    }))
  };
}

async function rollbackPendingUserTurn(conversationId, expected) {
  try {
    const saved = await memory.removeLastPendingUserMessage(conversationId, expected);
    conversation = saved.conversation;
    activePendingUser = null;
  } catch (err) {
    console.warn("ui: could not roll back the pending user message.", err && err.message ? err.message : err);
  }
}

function makeTurnId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "turn-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

function sanitizeTraceText(value) {
  return String(value || "").replace(/[\r\n\t]+/g, " ").slice(0, 240);
}

function appendTimingTrace(timing) {
  const phases = Array.isArray(timing?.phases) ? timing.phases : [];
  if (phases.length === 0) return;
  const detail = phases
    .map((phase) => phase.name + (phase.durationMs > 0 ? " " + phase.durationMs + "ms" : ""))
    .join(" → ");
  dialogs.appendTrace(sanitizeTraceText("Timing: " + detail));
}

function formatTelemetryLine({ timing, usage, billing } = {}) {
  const items = [];
  if (Number.isFinite(timing?.totalMs)) items.push((timing.totalMs / 1000).toFixed(1) + "s");
  if (Number.isFinite(usage?.totalTokens)) items.push(usage.totalTokens + " tokens");
  if (billing?.basis === "provider_reported" && billing.complete === true &&
    Number.isFinite(billing.amountUsd)) {
    items.push("$" + billing.amountUsd.toFixed(4) + " reported");
  }
  return items.join(" · ");
}

function appendTelemetryTrace({ timing, usage, billing } = {}) {
  const line = formatTelemetryLine({ timing, usage, billing });
  if (line) dialogs.appendTrace("Metrics: " + line);
}

function preferenceFromTitle(rec, polarity) {
  const title = typeof rec?.t === "string" ? rec.t.trim().slice(0, 80) : "";
  const subjectId = typeof rec?.id === "string" ? rec.id.trim().slice(0, 80) : "";
  const genres = Array.isArray(rec?.g) ? rec.g.filter((v) => typeof v === "string" && v.trim()).map((v) => v.trim()) : [];
  const reason = isUsefulReason(rec?.reason)
    ? String(rec.reason).trim().slice(0, 120)
    : genres.slice(0, 2).join(", ").slice(0, 120);
  if (polarity === "avoid" && title) {
    return { kind: "theme", polarity: "avoid", value: title, subjectId, subjectTitle: title, reason };
  }
  if (genres[0]) {
    return { kind: "genre", polarity, value: genres[0].slice(0, 80), subjectId, subjectTitle: title, reason };
  }
  if (title) {
    return { kind: "theme", polarity, value: title, subjectId, subjectTitle: title, reason };
  }
  return null;
}

function describeLearnedChange(before, after) {
  if (!after?.items?.length) return "";
  const prior = new Map((before?.items || []).map((item) => [item.id, item]));
  const newest = [...after.items]
    .filter((item) => {
      const old = prior.get(item.id);
      return !old || old.polarity !== item.polarity;
    })
    .sort((left, right) => String(right.lastConfirmedAt || "").localeCompare(String(left.lastConfirmedAt || "")))[0];
  if (!newest) return "";
  const verb = newest.polarity === "avoid" ? "less" : "more";
  return "Got it — " + verb + " " + newest.value;
}

async function removeTitleFromQueue(titleId) {
  for (const node of document.querySelectorAll("#chat-transcript .chat-picks .card")) {
    if (node.dataset.titleId === titleId) {
      const parent = node.parentElement;
      node.remove();
      if (parent && parent.children.length === 0) parent.remove();
    }
  }
  const nextItems = (recommendationQueue.items || []).filter((item) => item.id !== titleId);
  if (nextItems.length === recommendationQueue.items.length) {
    renderQueue();
    return;
  }
  await persistQueue({
    ...recommendationQueue,
    items: nextItems,
    source: nextItems.length ? recommendationQueue.source : null
  });
}

function stampMark(history, { key, title, bucket, source }) {
  return rememberMark(history?.marks, {
    key,
    title,
    bucket,
    source,
    at: new Date(Date.now()).toISOString()
  });
}

async function markTitleSeen(rec, bucket = "seen") {
  const title = typeof rec?.t === "string" ? rec.t.trim() : "";
  const key = normalizeTitle(title);
  if (!key) return;
  const now = new Date(Date.now()).toISOString();
  const existing = await memory.getHistory();
  const blocked = bucket === "blocked";
  const marks = stampMark(existing, { key, title, bucket: blocked ? "blocked" : "seen", source: "button" });
  if (!existing) {
    await memory.setHistory({
      schema: 2,
      importedAt: now,
      sources: [{ name: blocked ? "Hidden in picks" : "Marked in picks", kind: "manual" }],
      series: !blocked && rec?.k === "tv" ? [{ name: title, episodes: 1, lastWatched: null }] : [],
      movies: blocked || rec?.k === "tv" ? [] : [{ title, lastWatched: null }],
      other: [],
      seen: blocked ? [] : [key],
      blocked: blocked ? [key] : [],
      marks
    });
  } else if (blocked) {
    const keys = new Set(Array.isArray(existing.blocked) ? existing.blocked : []);
    keys.add(key);
    await memory.setHistory({ ...existing, blocked: Array.from(keys).sort(), marks });
  } else {
    const seen = new Set(Array.isArray(existing.seen) ? existing.seen : []);
    seen.add(key);
    const movies = Array.isArray(existing.movies) ? existing.movies.slice() : [];
    const series = Array.isArray(existing.series) ? existing.series.slice() : [];
    const inMovies = movies.some((entry) => normalizeTitle(entry?.title) === key);
    const inSeries = series.some((entry) => normalizeTitle(entry?.name) === key);
    if (!inMovies && !inSeries) {
      if (rec?.k === "tv") series.push({ name: title, episodes: 1, lastWatched: null });
      else movies.push({ title, lastWatched: null });
    }
    await memory.setHistory({
      ...existing,
      movies,
      series,
      seen: Array.from(seen).sort(),
      marks
    });
  }
  await refreshSeenKeys();
  renderConversation();
}

async function markTitlesSeen(titles) {
  const named = (Array.isArray(titles) ? titles : [])
    .map((title) => ({ title: String(title || "").trim(), key: normalizeTitle(title) }))
    .filter((item) => item.key);
  if (named.length === 0) return;
  const now = new Date(Date.now()).toISOString();
  const existing = await memory.getHistory();
  const seen = new Set(Array.isArray(existing?.seen) ? existing.seen : []);
  let marks = existing?.marks;
  for (const item of named) {
    seen.add(item.key);
    marks = stampMark({ marks }, { key: item.key, title: item.title, bucket: "seen", source: "chat" });
  }
  if (!existing) {
    await memory.setHistory({
      schema: 2,
      importedAt: now,
      sources: [{ name: "Marked in picks", kind: "manual" }],
      series: [],
      movies: named.map((item) => ({ title: item.title, lastWatched: null })),
      other: [],
      seen: Array.from(seen).sort(),
      marks
    });
  } else {
    const movies = Array.isArray(existing.movies) ? existing.movies.slice() : [];
    const series = Array.isArray(existing.series) ? existing.series : [];
    for (const item of named) {
      const inMovies = movies.some((entry) => normalizeTitle(entry?.title) === item.key);
      const inSeries = series.some((entry) => normalizeTitle(entry?.name) === item.key);
      if (!inMovies && !inSeries) movies.push({ title: item.title, lastWatched: null });
    }
    await memory.setHistory({ ...existing, movies, seen: Array.from(seen).sort(), marks });
  }
  await refreshSeenKeys();
  renderConversation();
}

async function onPickFeedback(titleId, action, rec) {
  try {
    if (action === "like" || action === "pass") {
      if (profile?.memoryEnabled === false) {
        queueView?.setFeedbackNote("Turn on learned preferences in Profile & context to save this.");
        return;
      }
      const candidate = preferenceFromTitle(rec, action === "like" ? "like" : "avoid");
      if (!candidate) {
        queueView?.setFeedbackNote("Could not learn from that title.");
        return;
      }
      const before = learned || await memory.getLearned();
      const next = upsertLearnedPreference(before, candidate);
      learned = await memory.setLearned(next);
      const note = describeLearnedChange(before, learned) ||
        (action === "like" ? "Got it — more like that." : "Got it — less of that.");
      queueView?.setFeedbackNote(note);
      if (action === "pass") await removeTitleFromQueue(titleId);
      return;
    }
    if (action === "seen") {
      await markTitleSeen(rec);
      await removeTitleFromQueue(titleId);
      queueView?.setFeedbackNote("Marked as seen — will not recommend it again.");
      return;
    }
    if (action === "blocked") {
      await markTitleSeen(rec, "blocked");
      await removeTitleFromQueue(titleId);
      renderConversation();
      queueView?.setFeedbackNote("Hidden. I will not suggest it again.");
      return;
    }
    if (action === "tonight") {
      await removeTitleFromQueue(titleId);
      queueView?.setFeedbackNote("Dismissed.");
    }
  } catch (error) {
    showError(error && error.message ? error.message : "Could not save that feedback.");
  }
}

function userFacingMilestone(phase, text) {
  const raw = String(text || phase || "").trim();
  const key = String(phase || text || "").trim().toUpperCase();
  if (key === "PLANNING" || /checking your services|seeing what you can watch/i.test(raw)) {
    return "Seeing what you can watch";
  }
  if (key === "SEARCHING CATALOG" || /searching|looking for a good fit/i.test(raw)) {
    return "Looking for a good fit";
  }
  if (key === "ANALYZING MATCHES" || /comparing matches|narrowing it down/i.test(raw)) {
    return "Narrowing it down";
  }
  if (key === "WRITING" || /writing your picks|choosing a few to watch|answering|thinking about that one/i.test(raw)) {
    return /answering|thinking about that one/i.test(raw)
      ? "Thinking about that one"
      : "Choosing a few to watch";
  }
  if (/taking longer/i.test(raw)) return "Still working — this is taking longer than usual";
  return raw || "Working";
}

async function labelNewConversation(query, { conversationId, signal, turnGeneration, turnId } = {}) {
  if (!conversationId || conversation.messages.length !== 1) return;
  let title = "";
  try {
    if (hasDeterministicAgent()) {
      title = String(query).split(/\s+/).slice(0, 7).join(" ");
    } else {
      title = await generateConversationTitle(store.getLlm(), query, { signal });
    }
  } catch (error) {
    if (error?.name === "AbortError" || signal?.aborted) throw error;
    dialogs.appendTrace("Conversation title unavailable");
    return;
  }
  if (!title || turnGeneration !== stateGeneration || activeTurnId !== turnId) return;
  const saved = await memory.renameConversation(conversationId, title);
  if (saved.conversation.id !== conversationId || turnGeneration !== stateGeneration || activeTurnId !== turnId) return;
  conversation = saved.conversation;
  await refreshConversationList();
  dialogs.appendTrace("Conversation titled: " + sanitizeTraceText(title));
}

function failureRecovery(code, message, timing) {
  const raw = String(message || "").trim();
  const seconds = Number.isFinite(timing?.totalMs) ? (timing.totalMs / 1000).toFixed(1) + "s" : "";
  const detail = [raw, seconds].filter(Boolean).join(" · ");
  const table = {
    budget: {
      title: "This model kept searching and never picked something.",
      hint: "Try another model. Your question is still in the box."
    },
    rate: {
      title: "The model service asked us to wait.",
      hint: "Wait a moment, then press Send."
    },
    network: {
      title: "The request did not reach the model.",
      hint: "Check your connection, then press Send."
    },
    auth: {
      title: "The API key was rejected.",
      hint: "Open Settings and check the key."
    },
    credit: {
      title: "This account is out of credit.",
      hint: "Add credit, or switch to another model."
    },
    context: {
      title: "That question was too long for this model.",
      hint: "Shorten it, or start a new chat, then press Send."
    },
    parse: {
      title: "The model reply could not be used.",
      hint: "Try another model. Your question is still in the box."
    }
  };
  const row = table[code] || {
    title: "This search did not finish.",
    hint: "Press Send to try again, or switch model."
  };
  return { title: row.title, hint: row.hint, detail };
}

function buildSwitchOption(query, code) {
  if (code === "aborted" || code === "auth") return null;
  const trimmed = String(query || "").trim();
  if (!trimmed) return null;
  const currentLlm = store.getLlm();
  const nextModel = nextRecommendedOpenRouterModel(currentLlm?.model);
  if (!nextModel || !nextModel.id || nextModel.id === currentLlm?.model) return null;
  return {
    name: nextModel.name,
    modelId: nextModel.id,
    onSwitch: () => {
      const latest = store.getLlm();
      store.setLlm({ ...latest, model: nextModel.id });
      if (chat.getQuery() === trimmed) chat.clearQuery();
      void onSubmit({ query: trimmed });
    }
  };
}

function makeEventHandler({ turnId, turnGeneration, startedAt, query, onMeaningfulProgress, onFirstVisibleToken, onErrorEvent }) {
  return function onEvent(event) {
    if (!event || typeof event !== "object" || event.turnId !== turnId ||
      turnGeneration !== stateGeneration || activeTurnId !== turnId) return;
    if (event.type === "context") {
      const diagnostics = event.diagnostics || {};
      const turns = diagnostics.conversation || {};
      const clipped = turns.droppedTurns > 0 || diagnostics.youmdTruncated === true
        || diagnostics.queue?.truncated === true;
      const turnClass = typeof diagnostics.turnClass === "string" ? diagnostics.turnClass : "";
      dialogs.appendTrace(
        "Context: " + (turns.includedTurns || 0) + "/" + (turns.totalTurns || 0)
          + " complete turns · " + (diagnostics.totalCharacters || 0)
          + " chars" + (clipped ? " · clipped" : " · complete")
          + (turnClass ? " · " + turnClass : "")
          + (Number.isFinite(diagnostics.plannerBudget) ? " · planner≤" + diagnostics.plannerBudget : "")
      );
      return;
    }
    if (event.type === "status") {
      dialogs.appendTrace(sanitizeTraceText(event.phase || event.text));
      chat.setTurnStatus(userFacingMilestone(event.phase, event.text));
      onMeaningfulProgress();
      return;
    }
    if (event.type === "tool_call") {
      dialogs.appendTrace("Catalog tool requested");
      chat.setTurnStatus(userFacingMilestone("SEARCHING CATALOG"));
      onMeaningfulProgress();
      return;
    }
    if (event.type === "tool_result") {
      dialogs.appendTrace("Catalog tool returned " + (Number.isFinite(event.count) ? event.count : 0) + " results");
      chat.addToolResult(event.count);
      chat.setTurnStatus(userFacingMilestone("ANALYZING MATCHES"));
      onMeaningfulProgress();
      return;
    }
    if (event.type === "delta") {
      chat.appendDelta(event.text);
      onFirstVisibleToken();
      onMeaningfulProgress();
      return;
    }
    if (event.type === "error") {
      onErrorEvent?.();
      chat.failTurn({
        ...event,
        switchOption: buildSwitchOption(query, event.code),
        recovery: failureRecovery(event.code, event.message, event.timing)
      });
    }
  };
}

function fileLabel(file) {
  const name = String(file && file.name || "").trim();
  return name || "file";
}

async function postLocalTurn(userText, produceReply) {
  if (controller || historyController) {
    chat.setNote("Finish the current turn first.");
    return;
  }
  const turnGeneration = stateGeneration;
  clearError();
  let pendingUser = null;
  try {
    const saved = await memory.appendUserMessage(conversation.id, userText);
    conversation = saved.conversation;
    const appended = conversation.messages.at(-1);
    pendingUser = { content: appended.content, createdAt: appended.createdAt };
    renderConversation();
  } catch (error) {
    showError(error && error.message ? error.message : "Could not save your message. Reload the page and try again.");
    return;
  }

  const thisController = new AbortController();
  controller = thisController;
  activePendingUser = pendingUser;
  localExchange = true;
  chat.setBusy(true);
  setShellBusy(true);
  try {
    const reply = await produceReply(thisController.signal);
    if (turnGeneration !== stateGeneration || controller !== thisController) return;
    const text = String(reply || "").trim() || "Done.";
    const saved = await memory.completeTurn(conversation.id, {
      content: text,
      meta: { status: "complete" }
    });
    if (turnGeneration !== stateGeneration || controller !== thisController) return;
    conversation = saved.conversation;
    activePendingUser = null;
    renderConversation();
  } catch (err) {
    const aborted = Boolean(err && err.name === "AbortError")
      || turnGeneration !== stateGeneration
      || controller !== thisController;
    if (aborted) {
      await rollbackPendingUserTurn(conversation.id, pendingUser);
      if (turnGeneration === stateGeneration) renderConversation();
      return;
    }
    const text = err && err.message ? err.message : "That did not work.";
    try {
      const saved = await memory.completeTurn(conversation.id, {
        content: text,
        meta: { status: "complete" }
      });
      if (turnGeneration !== stateGeneration || controller !== thisController) return;
      conversation = saved.conversation;
      activePendingUser = null;
      renderConversation();
    } catch (saveErr) {
      await rollbackPendingUserTurn(conversation.id, pendingUser);
      showError(saveErr && saveErr.message ? saveErr.message : "Could not save the reply.");
      renderConversation();
    }
  } finally {
    if (controller === thisController) {
      controller = null;
      activePendingUser = null;
      localExchange = false;
      chat.setBusy(false);
      setShellBusy(false);
      refreshSendReadiness();
    } else {
      localExchange = false;
    }
  }
}

async function onHistoryFile(file) {
  if (!file) return;
  const filename = fileLabel(file);
  await postLocalTurn(filename, async (signal) => {
    const parsed = await importHistoryFile(file, { signal });
    if (!Array.isArray(parsed?.seen) || parsed.seen.length === 0) {
      throw new Error(`"${filename}" has no readable titles.`);
    }
    const resolved = resolveHistoryWithCatalog(parsed, records);
    await memory.setHistory(resolved);
    historyCache = resolved;
    if (resolved.titleTags) {
      try {
        await runtime.setTitleTags(resolved.titleTags);
      } catch (err) {
        console.warn("ui: could not forward titleTags to runtime", err);
      }
    }
    await refreshSeenKeys();
    try {
      await pruneUnavailableAndWatched({
        reseedsIfEmpty: conversation.messages.length === 0
      });
      if (!recommendationQueue.source && recommendationQueue.items.length === 0) {
        await seedRecommendationQueue({ force: true });
      }
    } catch (err) {
      console.warn("ui: could not refresh the queue after import.", err && err.message ? err.message : err);
    }
    syncEnrichControls();
    return historyImportReply(filename, parsed);
  });
}

async function runChatCommand(query, command) {
  chat.clearQuery();
  await postLocalTurn(query, async () => {
    if (command.kind === "region") {
      await applyScope([...profile.providers], { region: command.region }, { reseedSeeded: true });
      return regionCommandReply(command.region);
    }
    await applyScope(command.providers, { region: currentRegion() }, { reseedSeeded: true });
    return subscriptionCommandReply(command.providers);
  });
}

// Rail "More" button: a plain chat message. It carries no count and no append flag;
// the agent reads it like any other turn and decides what to put on the rail.
const MORE_MESSAGE = "More, please";

function onShowMoreRequest() {
  if (controller || historyController) return;
  if (recommendationQueue.items.length === 0) return;
  if (!store.hasKey()) {
    // Same gate as the chat box: show the key banner, send nothing, change nothing.
    refreshSendReadiness();
    queueView?.setFeedbackNote("Add your API key in Settings to get more picks.");
    return;
  }
  void onSubmit({ query: MORE_MESSAGE });
}

async function onSubmit(options) {
  if (controller || historyController) return;
  // The chat box passes no options (or a DOM event). The rail button passes a fixed
  // query, which must not touch whatever the viewer is typing.
  const override = typeof options?.query === "string" && options.query.trim() ? options.query.trim() : null;
  const query = override ?? chat.getQuery();
  if (!query) return;
  const command = parseChatCommand(query);
  if (command) {
    await runChatCommand(query, command);
    return;
  }
  if (!store.hasKey()) {
    refreshSendReadiness();
    return;
  }
  const turnId = makeTurnId();
  const turnTiming = createTurnTiming(turnId);
  let agentStartedAt = null;
  let completedTiming = null;
  const finalizeTiming = (agentTiming = null) => {
    if (completedTiming) return completedTiming;
    if (agentTiming && agentStartedAt !== null) turnTiming.mergeAgent(agentTiming, agentStartedAt);
    completedTiming = turnTiming.finish();
    appendTimingTrace(completedTiming);
    return completedTiming;
  };

  clearError();
  if (!runtimeIsReady() && !hasDeterministicAgent()) {
    chat.setNote("Catalog analysis is still preparing. Try again in a moment.");
    return;
  }

  if (!override) chat.clearQuery();
  const turnGeneration = stateGeneration;
  const priorMessages = conversation.messages.slice();
  let pendingUser = null;
  try {
    const saved = await memory.appendUserMessage(conversation.id, query);
    conversation = saved.conversation;
    const appended = conversation.messages.at(-1);
    pendingUser = { content: appended.content, createdAt: appended.createdAt };
    renderConversation();
  } catch (error) {
    showError(error && error.message ? error.message : "Could not save your message. Reload the page and try again.");
    if (!override) chat.setQuery(query);
    return;
  }

  const thisController = new AbortController();
  controller = thisController;
  activeTurnId = turnId;
  activePendingUser = pendingUser;
  chat.setBusy(true);
  setShellBusy(true);
  dialogs.clearTrace();
  chat.startTurn();
  chat.setTurnStatus("Naming this chat");
  const startedAt = Date.now();
  let lastMeaningfulElapsed = 0;
  const activityTimer = window.setInterval(() => {
    if (turnGeneration !== stateGeneration || activeTurnId !== turnId) return;
    const elapsed = Math.max(0, Date.now() - startedAt);
    if (elapsed >= 1000) {
      const slow = elapsed - lastMeaningfulElapsed >= 20000;
      if (slow) chat.setTurnStatus(userFacingMilestone("TAKING LONGER THAN USUAL"));
      chat.setTurnElapsed(elapsed, { slow });
    }
  }, 250);
  const markProgress = () => { lastMeaningfulElapsed = Math.max(0, Date.now() - startedAt); };

  let youmd = "";
  let history = null;
  let seenKeys = [];
  let catalogManifest = { count: records.length, providers: [...scopeProviders()] };
  let turnFailed = false;

  try {
    // The label is intentionally resolved before catalog/model work. It gives the
    // sidebar a useful name at the beginning of a potentially long first turn.
    await labelNewConversation(query, {
      conversationId: conversation.id,
      signal: thisController.signal,
      turnGeneration,
      turnId
    });
    if (turnGeneration !== stateGeneration || activeTurnId !== turnId) return;
    chat.setTurnStatus(userFacingMilestone("PLANNING"));
    // IndexedDB personalization and the subscription-scoped catalog manifest are
    // independent; start both immediately and join only when building agent context.
    const contextTiming = turnTiming.start("indexeddb_context");
    const manifestTiming = turnTiming.start("catalog_manifest");
    const contextPromise = Promise.all([
      memory.getYouMd(),
      memory.getHistory(),
      memory.getLearned(),
      memory.getProfile(),
      memory.getThreads()
    ]).then((values) => {
      turnTiming.end(contextTiming);
      return values;
    }, (error) => {
      turnTiming.end(contextTiming);
      throw error;
    });
    const manifestPromise = getCatalogManifest({ signal: thisController.signal })
      .then((value) => {
        turnTiming.end(manifestTiming);
        return value;
      }, (error) => {
        turnTiming.end(manifestTiming);
        throw error;
      });

    const [contextResult, manifestResult] = await Promise.allSettled([contextPromise, manifestPromise]);
    if (turnGeneration !== stateGeneration || activeTurnId !== turnId) return;

    let regionCode = currentRegion();
    let recap = "";
    if (contextResult.status === "fulfilled") {
      const [manualYoumd, savedHistory, savedLearned, savedProfile, savedThreads] = contextResult.value;
      if (savedProfile?.region) regionCode = savedProfile.region;
      youmd = manualYoumd + (savedProfile.memoryEnabled === false ? "" : `\n\n${renderLearnedContext(savedLearned)}`);
      history = savedHistory;
      seenKeys = [...(savedHistory?.seen ?? []), ...(savedHistory?.blocked ?? [])];
      seenKeysCache = seenKeys;
      if (savedProfile?.memoryEnabled !== false) {
        recap = buildRecapBlock({
          turns: recallTurns(savedThreads?.items, priorMessages),
          query,
          resolveTitle: (id) => recordsById.get(id)?.t
        });
      }
    } else {
      showError("Saved preferences are temporarily unavailable; continuing without saved context.");
    }

    if (manifestResult.status === "fulfilled") {
      catalogManifest = manifestResult.value;
    } else if (manifestResult.reason && manifestResult.reason.name === "AbortError") {
      await rollbackPendingUserTurn(conversation.id, pendingUser);
      {
        const timing = finalizeTiming();
        appendTelemetryTrace({ timing });
        chat.failTurn({ message: "Stopped.", timing });
      }
      return;
    } else if (!hasDeterministicAgent()) {
      showError("Catalog analysis context is unavailable; continuing with a minimal manifest.");
    }

    if (turnGeneration !== stateGeneration || activeTurnId !== turnId) return;
    const temporal = buildTemporalBlock({
      now: new Date(Date.now()),
      lastActivityIso: priorMessages.at(-1)?.createdAt ?? null,
      region: regionCode
    });
    const runner = hasDeterministicAgent() ? window.__OTT_TEST_RUN_AGENT__ : runAgent;
    const regionPrompts = prompts && typeof prompts.system === "string"
      ? { ...prompts, system: prompts.system.replaceAll("{region}", regionCode) }
      : prompts;
    const includeWatched = allowsRewatch(query);
    const scopedQueue = {
      ...recommendationQueue,
      items: filterQueueItems(recommendationQueue.items, { includeWatched })
    };
    const currentQueue = recommendationQueueContext(scopedQueue);
    agentStartedAt = turnTiming.elapsed();
    turnTiming.point("agent_start");
    let firstVisibleTokenRecorded = false;
    const result = await runner({
      config: store.getLlm(),
      prompts: regionPrompts,
      tools: makeTools(includeWatched ? [] : seenKeys, currentQueue?.items || []),
      context: {
        youmd,
        history,
        mood: "",
        catalogManifest,
        recommendationQueue: currentQueue,
        temporal,
        recap
      },
      query,
      conversation: priorMessages,
      onEvent: makeEventHandler({
        turnId,
        turnGeneration,
        startedAt,
        query,
        onMeaningfulProgress: markProgress,
        onFirstVisibleToken: () => {
          if (firstVisibleTokenRecorded) return;
          firstVisibleTokenRecorded = true;
          turnTiming.point("first_visible_token");
        },
        onErrorEvent: () => { turnFailed = true; }
      }),
      signal: thisController.signal,
      turnId
    });

    if (turnGeneration !== stateGeneration || activeTurnId !== turnId) return;
    const timing = finalizeTiming(result.timing);
    const metricsTiming = result.timing && Number.isFinite(result.timing.totalMs) ? result.timing : timing;
    if (!result.ok) {
      appendTelemetryTrace({ timing: metricsTiming, usage: result.usage, billing: result.billing });
      if (!turnFailed) {
        chat.failTurn({
          message: "The turn did not complete. Check your connection or API key in Settings, then try again.",
          timing: metricsTiming,
          switchOption: buildSwitchOption(query, ""),
          recovery: failureRecovery("", "The turn did not complete. Check your connection or API key in Settings, then try again.", metricsTiming)
        });
      }
      await rollbackPendingUserTurn(conversation.id, pendingUser);
      if (!override) chat.restoreQueryIfEmpty(query);
      return;
    }

    const replyText = result.reply || prompts.no_results || "I couldn't come up with anything this time.";
    const watchedTitles = profile?.memoryEnabled !== false && Array.isArray(result.watched) ? result.watched : [];
    if (watchedTitles.length) {
      await markTitlesSeen(watchedTitles);
      seenKeys = seenKeysCache;
    }
    // The agent owns the rail. result.queue is the list, result.queueMode says whether it
    // replaces or is added after what is on screen, result.showAll says whether to fold.
    // The UI applies that, plus the hard cap, and nothing else.
    let nextQueue = recommendationQueue;
    let shownIds = new Set(); // ids this turn surfaced, for the inline chat cards
    let overflow = 0;
    if (Array.isArray(result.queue)) {
      const includeWatched = allowsRewatch(query);
      const grounded = sanitizeRecommendationQueue({
        source: {
          conversationId: conversation.id,
          turnId,
          query
        },
        items: result.queue
      });
      if (grounded) {
        const filtered = filterQueueItems(grounded.items, { includeWatched });
        const showAll = typeof result.showAll === "boolean" ? result.showAll : null;
        if (normalizeQueueMode(result.queueMode) === "append") {
          // Keep what is on screen as it is now (a card dismissed mid-turn stays gone).
          const have = new Set(recommendationQueue.items.map((item) => item.id));
          const added = filtered.filter((item) => !have.has(item.id));
          const merged = [...recommendationQueue.items, ...added];
          overflow = Math.max(0, merged.length - RECOMMENDATION_LIMITS.items);
          const items = merged.slice(0, RECOMMENDATION_LIMITS.items);
          const kept = new Set(added.map((item) => item.id));
          shownIds = new Set(items.filter((item) => kept.has(item.id)).map((item) => item.id));
          nextQueue = {
            ...recommendationQueue,
            items,
            showAll: (showAll ?? recommendationQueue.showAll === true) || undefined
          };
        } else {
          nextQueue = { ...grounded, items: filtered, showAll: showAll === true || undefined };
          shownIds = new Set(filtered.map((item) => item.id));
        }
      }
    }
    if (watchedTitles.length) {
      const watchedKeys = new Set(watchedTitles.map((title) => normalizeTitle(title)).filter(Boolean));
      nextQueue = {
        ...nextQueue,
        items: nextQueue.items.filter((item) => !watchedKeys.has(normalizeTitle(recordsById.get(item.id)?.t || "")))
      };
    }
    // Inline chat cards mirror what the agent surfaced this turn, however many that is.
    // A turn that left the rail alone (no queue in the decision) attaches nothing.
    const pickItems = nextQueue.items.filter((item) => shownIds.has(item.id));
    const picks = pickItems.map((item) => ({ id: item.id, reason: item.reason || "" }));
    const priorLearned = learned || await memory.getLearned();
    const nextLearned = Array.isArray(result.memoryCandidates) && profile?.memoryEnabled !== false
      ? mergeLearnedPreferences(priorLearned, result.memoryCandidates, query)
      : priorLearned;
    const saved = await memory.completeTurn(conversation.id, {
      content: replyText,
      queue: nextQueue,
      meta: {
        status: "complete",
        timing,
        usage: result.usage,
        billing: result.billing
      },
      learned: nextLearned,
      picks
    });
    conversation = saved.conversation;
    activePendingUser = null;
    recommendationQueue = saved.queue;
    learned = saved.learned ?? nextLearned;
    // Titles the agent appended are the ones the person just asked to see: unfold the
    // rail and scroll to the first of them instead of leaving them behind a toggle.
    const appended = normalizeQueueMode(result.queueMode) === "append" && shownIds.size > 0;
    const firstNew = appended ? recommendationQueue.items.findIndex((item) => shownIds.has(item.id)) : -1;
    renderQueue({ revealFrom: firstNew >= 0 ? firstNew : null });
    appendTelemetryTrace({ timing: metricsTiming, usage: result.usage, billing: result.billing });
    chat.completeTurn({
      reply: replyText,
      timing: metricsTiming,
      catalogCount: typeof catalogMeta?.count === "number" ? catalogMeta.count : records.length
    });
    const inlineRecs = picks.map((pick) => hydrate(pick.id, pick.reason)).filter(Boolean);
    if (inlineRecs.length) chat.appendPicks(inlineRecs);
    const learnedNote = describeLearnedChange(priorLearned, learned);
    if (learnedNote) queueView?.setFeedbackNote(learnedNote);
    else if (watchedTitles.length) queueView?.setFeedbackNote("Marked " + watchedTitles.join(", ") + " as seen.");
    if (overflow > 0) {
      queueView?.setFeedbackNote("The rail holds " + RECOMMENDATION_LIMITS.items + " picks at most, so " + overflow + " did not fit.");
    }
  } catch (err) {
    if (turnGeneration === stateGeneration && activeTurnId === turnId) {
      await rollbackPendingUserTurn(conversation.id, pendingUser);
      const timing = finalizeTiming();
      appendTelemetryTrace({ timing });
      if (!turnFailed) {
        chat.failTurn({
          message: err && err.message ? err.message : "The search failed.",
          timing,
          switchOption: buildSwitchOption(query, err?.code || ""),
          recovery: failureRecovery(err?.code || "", err?.message || "The search failed.", timing)
        });
      }
      if (!override) chat.restoreQueryIfEmpty(query);
    }
  } finally {
    window.clearInterval(activityTimer);
    if (controller === thisController) {
      controller = null;
      if (activeTurnId === turnId) activeTurnId = null;
      chat.setBusy(false);
      setShellBusy(false);
      refreshSendReadiness();
    }
  }
}

async function onStop() {
  if (!controller) return;
  const conversationId = conversation.id;
  const pendingUser = activePendingUser;
  const local = localExchange;
  if (!local) chat.failTurn({ message: "Stopped.", status: "Stopped" });
  cancelActiveTurn();
  await rollbackPendingUserTurn(conversationId, pendingUser);
  if (local) renderConversation();
  else chat.restoreQueryIfEmpty(pendingUser?.content);
}

// ---- New chat / subscriptions / context / backup ---------------------------

function cancelActiveTurn() {
  stateGeneration += 1;
  if (controller) controller.abort();
  controller = null;
  activeTurnId = null;
  activePendingUser = null;
  if (chat) {
    chat.setBusy(false);
    refreshSendReadiness();
  }
  setShellBusy(false);
}

function cancelActiveOperations() {
  cancelActiveTurn();
  cancelActiveHistoryImport();
}

async function onNewChat() {
  cancelActiveTurn();
  const saved = await memory.startNewConversation();
  conversation = saved.conversation;
  recommendationQueue = saved.queue;
  renderConversation();
  await seedQueueIfEmpty();
  updateCatalogStatusLine();
  clearError();
}

async function onActivateConversation(conversationId) {
  cancelActiveTurn();
  try {
    const saved = await memory.activateArchivedConversation(conversationId);
    conversation = saved.conversation;
    recommendationQueue = saved.queue;
    await refreshSeenKeys();
    renderConversation();
    await pruneUnavailableAndWatched({
      reseedsIfEmpty: conversation.messages.length === 0,
      includeWatched: false
    });
    clearError();
  } catch (error) {
    showError(error && error.message ? error.message : "Could not open that conversation. Select another chat or start a new one.");
  }
}

async function onRenameConversation(conversationId, title) {
  cancelActiveTurn();
  const saved = await memory.renameConversation(conversationId, title);
  conversation = saved.conversation;
  await refreshConversationList();
  clearError();
}

async function onDeleteConversation(conversationId) {
  cancelActiveTurn();
  const saved = await memory.deleteConversation(conversationId);
  conversation = saved.conversation;
  recommendationQueue = saved.queue;
  await refreshSeenKeys();
  renderConversation();
  if (conversation.messages.length === 0) {
    await seedQueueIfEmpty();
  } else {
    await pruneUnavailableAndWatched({ reseedsIfEmpty: false });
  }
  updateCatalogStatusLine();
  clearError();
}

async function applyScope(newProviders, extra = {}, { reseedSeeded = false } = {}) {
  const region = typeof extra.region === "string" && extra.region ? extra.region : currentRegion();
  const regionChanged = region !== currentRegion();
  profile = await memory.setProfile({ ...profile, providers: newProviders, region, onboardingComplete: true });
  subscriptions = new Set(profile.providers);
  if (regionChanged || extra.region) await syncRegion(profile.region);
  updateRuntimeCatalogMetadata();
  sidebar.renderSubscriptions(profile.providers);
  renderPlaylists();
  titleDetailsView?.refresh();
  await refreshSeenKeys();
  const reseed = conversation.messages.length === 0 || (reseedSeeded && !recommendationQueue.source);
  if (reseed) {
    // Empty chats, and chat commands against a seed queue, rebuild for the new scope.
    await seedRecommendationQueue({ force: true });
  } else {
    const available = filterQueueItems(recommendationQueue.items);
    if (available.length !== recommendationQueue.items.length) {
      await persistQueue({
        ...recommendationQueue,
        items: available,
        source: available.length ? recommendationQueue.source : null
      });
    } else {
      renderQueue();
    }
  }
  refreshSendReadiness();
}

async function onSubscriptionsChange(newProviders, extra = {}) {
  cancelActiveTurn();
  await applyScope(newProviders, extra);
  renderConversation();
}

function exportMeta() {
  return { query: conversation.messages.filter((m) => m.role === "user").at(-1)?.content || "", generatedAt: new Date().toISOString() };
}

function getExportPicks() {
  return hydratedQueue();
}

async function onSaveContextMemory(payload) {
  const saved = await memory.saveContextMemory(payload);
  profile = saved.profile;
  learned = saved.learned;
  subscriptions = new Set(profile.providers);
  sidebar.renderSubscriptions(profile.providers);
  titleDetailsView?.refresh();
  if (payload.history !== undefined) {
    await refreshSeenKeys();
    await pruneUnavailableAndWatched({
      reseedsIfEmpty: conversation.messages.length === 0
    });
  }
  renderConversation();
  return saved;
}

async function onExportBackup() {
  try {
    const backup = await memory.exportBackup();
    downloadText("memory.json", "application/json;charset=utf-8", JSON.stringify(backup, null, 2));
  } catch (err) {
    showError("Could not export a backup. Check your browser storage settings and try again.");
  }
}

const RESET_CONFIRM = "Start over? This removes conversations, your queue, learned facts, seen and blocked titles, imported history, You.md, region, subscriptions, and layout. Your API key stays.";

function reloadApp() {
  const url = new URL(window.location.href);
  url.searchParams.delete("reset");
  const next = url.pathname + url.search + url.hash;
  try {
    window.history.replaceState(null, "", next);
  } catch {
    // Some embedded browsers refuse replaceState. The reload still drops ?reset when assigned below.
  }
  try {
    window.location.reload();
  } catch {
    window.location.href = next;
  }
}

async function onResetKeepKey() {
  if (!window.confirm(RESET_CONFIRM)) return;
  try {
    cancelActiveOperations();
    await memory.clear();
    if (!store.clearAll({ keepLlm: true })) throw new Error("Local data could not be reset.");
    reloadApp();
  } catch (err) {
    showError("Could not start over. Reload the page and try again.");
  }
}

async function onClearData() {
  if (!window.confirm("Clear everything? This removes your conversation, queue, subscriptions, You.md, watch history, and API key from this browser and cannot be undone.")) {
    return;
  }
  try {
    cancelActiveOperations();
    await memory.clear();
    if (!store.clearAll()) throw new Error("The saved API key could not be removed.");
    reloadApp();
  } catch (err) {
    showError("Could not clear local data. Reload the page and try again.");
  }
}

function importedHistoryLine(history) {
  const sources = Array.isArray(history?.sources) ? history.sources : [];
  const counts = { netflix: 0, youtube: 0 };
  const named = [];
  for (const source of sources) {
    const count = Number(source?.records);
    if (!Number.isFinite(count) || count <= 0) continue;
    const kind = source?.kind;
    if (kind === "netflix" || kind === "youtube") counts[kind] += count;
    else if (typeof source?.name === "string" && source.name) {
      named.push(source.name + ": " + count.toLocaleString("en-IN"));
    }
  }
  const parts = [];
  if (counts.netflix) {
    parts.push("Netflix: " + counts.netflix.toLocaleString("en-IN") + (counts.netflix === 1 ? " title" : " titles"));
  }
  if (counts.youtube) {
    parts.push("YouTube: " + counts.youtube.toLocaleString("en-IN") + (counts.youtube === 1 ? " video" : " videos"));
  }
  parts.push(...named);
  return parts.length ? parts.join(" · ") : "No imported history.";
}

function markedRows(history) {
  const marks = Array.isArray(history?.marks) ? history.marks : [];
  const seen = marks
    .filter((mark) => mark.bucket === "seen" && (mark.source === "chat" || mark.source === "button"))
    .sort((left, right) => String(right.at || "").localeCompare(String(left.at || "")))
    .slice(0, 50);
  const blocked = marks.filter((mark) => mark.bucket === "blocked");
  const known = new Set(blocked.map((mark) => mark.key));
  const extra = (Array.isArray(history?.blocked) ? history.blocked : [])
    .filter((key) => typeof key === "string" && key && !known.has(key))
    .map((key) => ({ key, title: key, bucket: "blocked", source: "button", at: "" }));
  return seen.concat(blocked, extra);
}

function wireMemoryDialog() {
  async function onLearnedChange(draft) {
    learned = await memory.setLearned(draft);
    renderConversation();
  }
  el.memoryClose.addEventListener("click", () => el.memoryDialog.close());
  el.memoryEnrichBtn?.addEventListener("click", () => void onEnrich());
  el.memoryImportRemove.addEventListener("click", () => {
    void (async () => {
      const existing = await memory.getHistory();
      const marks = Array.isArray(existing?.marks) ? existing.marks : [];
      if (!existing || marks.length === 0) {
        await memory.setHistory(null);
      } else {
        const seen = marks.filter((mark) => mark.bucket === "seen").map((mark) => mark.key);
        const blocked = marks.filter((mark) => mark.bucket === "blocked").map((mark) => mark.key);
        await memory.setHistory({
          schema: 2,
          importedAt: null,
          sources: [],
          series: [],
          movies: [],
          other: [],
          seen: [...new Set(seen)].sort(),
          blocked: [...new Set(blocked)].sort(),
          marks
        });
      }
      await refreshSeenKeys();
      renderConversation();
      if (conversation.messages.length === 0) await seedRecommendationQueue({ force: true });
      await openMemoryDialog();
    })().catch((err) => showError(err && err.message ? err.message : "Could not remove imported history. Reload the page and try again."));
  });
  return onLearnedChange;
}

let onMemoryLearnedChange = null;

async function openMemoryDialog() {
  const history = await memory.getHistory();
  learned = await memory.getLearned();
  historyCache = history;
  renderLearnedFacts(el.memoryFacts, learned, onMemoryLearnedChange);
  el.memoryMarks.textContent = "";
  const rows = markedRows(history);
  if (rows.length === 0) {
    const empty = document.createElement("p");
    empty.className = "note";
    empty.textContent = "Nothing marked in chat yet.";
    el.memoryMarks.appendChild(empty);
  } else {
    for (const mark of rows) {
      const row = document.createElement("div");
      row.className = "memory-mark";
      row.setAttribute("role", "listitem");
      const label = document.createElement("span");
      const kind = mark.bucket === "blocked" ? "Can't open it" : "Seen";
      label.textContent = mark.title + " · " + kind;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => {
        void (async () => {
          await memory.unmarkTitle(mark.key);
          await refreshSeenKeys();
          renderConversation();
          if (conversation.messages.length === 0) await seedRecommendationQueue({ force: true });
          else await pruneUnavailableAndWatched({ reseedsIfEmpty: false });
          await openMemoryDialog();
        })().catch((err) => showError(err && err.message ? err.message : "Could not remove that title. Reload the page and try again."));
      });
      row.append(label, remove);
      el.memoryMarks.appendChild(row);
    }
  }
  el.memoryImports.textContent = importedHistoryLine(history);
  const imported = importedHistoryLine(history) !== "No imported history.";
  el.memoryImportRemove.hidden = !imported;
  syncEnrichControls();
  if (!el.memoryDialog.hasAttribute("open")) el.memoryDialog.showModal();
}

async function reloadFromMemory() {
  profile = await memory.getProfile();
  subscriptions = new Set(profile.providers);
  conversation = await memory.getConversation();
  recommendationQueue = await memory.getQueue();
  learned = await memory.getLearned();
  playlists = await memory.getPlaylists();
  await refreshSeenKeys();
  sidebar.renderSubscriptions(profile.providers);
  renderConversation();
  renderPlaylists();
  titleDetailsView?.refresh();
  await pruneUnavailableAndWatched({
    reseedsIfEmpty: conversation.messages.length === 0
  });
  if (recommendationQueue.items.length === 0) await seedQueueIfEmpty();
}

// ---- Onboarding --------------------------------------------------------------

async function onOnboardingComplete(payload) {
  if (payload.history) await memory.setHistory(payload.history);
  profile = await memory.setProfile({
    providers: payload.providers,
    region: payload.region || DEFAULT_REGION,
    onboardingComplete: true
  });
  subscriptions = new Set(profile.providers);
  await syncRegion(profile.region);
  updateRuntimeCatalogMetadata();
  await showShell();
}

async function showShell() {
  onboarding.hide();
  el.shell.hidden = false;
  await reloadFromMemory();
  updateCatalogStatusLine();
}

// ---- Boot ---------------------------------------------------------------------

async function loadCatalog() {
  queueView && queueView.setCatalogStatus("Loading catalog…");
  const [promptsDoc, catalogDoc] = await Promise.all([
    fetchJson("./assets/prompts.json"),
    fetchJson("./assets/catalog.json")
  ]);
  prompts = promptsDoc;
  paidRecords = Array.isArray(catalogDoc.records) ? catalogDoc.records : [];
  paidCount = typeof catalogDoc.meta?.count === "number" ? catalogDoc.meta.count : paidRecords.length;
  freeDoc = await fetchJson("./assets/free-sources.json").catch(() => null);
  catalogMeta = catalogDoc.meta || {};
  const loadedOrder = Array.isArray(catalogMeta.provider_order) ? catalogMeta.provider_order : [];
  catalogProviderOrder = loadedOrder.filter((slug) => typeof slug === "string" && slug);
  applyFreeMerge(DEFAULT_REGION);
  // Main thread keeps display/resolve projections only; the Worker owns search indexing.
}

function initializeCatalogRuntime() {
  void runtime.initialize()
    .catch(reportCatalogRuntimeFailure);
}

function reportCatalogRuntimeFailure(error) {
  catalogRuntimeError = error || new Error("Catalog runtime is unavailable.");
  console.warn("ui: catalog runtime unavailable.", error && error.message ? error.message : error);
  updateCatalogStatusLine();
}

function updateRuntimeCatalogMetadata() {
  void getCatalogManifest()
    .then((manifest) => {
      if (manifest && manifest.meta && typeof manifest.meta === "object") {
        catalogMeta = { ...catalogMeta, ...manifest.meta };
        updateCatalogStatusLine();
      }
    })
    .catch(reportCatalogRuntimeFailure);
}

async function init() {
  el = collectDom();
  if (!el) return;

  dialogs = createDialogs(el, {
    providerOrder,
    store,
    getProfile: () => memory.getProfile(),
    getYouMd: () => memory.getYouMd(),
    getLearned: () => memory.getLearned(),
    saveContextMemory: onSaveContextMemory,
    getHistory: async () => {
      historyCache = await memory.getHistory();
      return historyCache;
    },
    setHistory: async (v) => {
      historyCache = v;
      return memory.setHistory(v);
    },
    summarizeHistory: summarize,
    onSubscriptionsChange,
    catalogMeta: () => catalogMeta,
    getExportPicks,
    exportMeta,
    onExportBackup,
    onClearData,
    onResetKeepKey,
    onError: showError,
    onEnrich: () => void onEnrich(),
    onSyncEnrich: () => syncEnrichControls()
  });

  sidebar = createSidebarView(el, {
    providerLabel,
    onNewChat,
    onActivateConversation,
    onRenameConversation,
    onDeleteConversation,
    onRefreshConversations: refreshConversationList,
    onOpenSettings: () => dialogs.openSettings(),
    onOpenPlaylists: () => playlistsView.openManager(),
    onError: showError,
    getCollapsed: () => store.getSidebarCollapsed(),
    setCollapsed: (collapsed) => store.setSidebarCollapsed(collapsed)
  });

  createPaneLayoutView(el, {
    getLayout: () => store.getPaneLayout(),
    setLayout: (layout) => store.setPaneLayout(layout)
  });

  onMemoryLearnedChange = wireMemoryDialog();

  chat = createChatView(el, {
    onSubmit,
    onFile: (file) => {
      void onHistoryFile(file);
    },
    isLocalCommand: (query) => parseChatCommand(query) !== null,
    onStop,
    onOpenMemory: () => {
      void openMemoryDialog().catch((err) => showError(err && err.message ? err.message : "Could not open what I remember."));
    },
    onEnrich: () => void onEnrich(),
    renderInlinePicks: (recs) => queueView?.renderInline(recs) ?? null
  });

  titleDetailsView = createTitleDetailsView(el, { resolveDetails: resolveTitleDetails });

  queueView = createQueueView(el, {
    watchCta,
    onOpenPlaylistPicker: (titleId, title) => playlistsView.openPicker(titleId, title),
    onOpenTitleDetails: (titleId, trigger) => titleDetailsView.open(titleId, trigger),
    onFeedback: onPickFeedback,
    onShowMore: onShowMoreRequest
  });

  playlistsView = createPlaylistsView(el, {
    onToggle: onPlaylistToggle,
    onRemove: (playlistId, titleId) => savePlaylistMutation((state) =>
      removeFromPlaylist(state, playlistId, titleId)),
    onCreate: (name) => savePlaylistMutation((state) => createPlaylist(state, name)),
    onRename: (playlistId, name) => savePlaylistMutation((state) =>
      renamePlaylist(state, playlistId, name)),
    onDelete: (playlistId) => savePlaylistMutation((state) => deletePlaylist(state, playlistId)),
    onExport: onPlaylistExport,
    onOpenTitleDetails: (titleId, trigger) => titleDetailsView.open(titleId, trigger)
  });

  onboarding = createOnboardingView(el, {
    providerOrder,
    store,
    DEFAULT_LLM,
    onComplete: onOnboardingComplete,
    onError: (message) => showError(message)
  });

  try {
    clearError();
    await loadCatalog();
    updateCatalogStatusLine();
    initializeCatalogRuntime();

    const initResult = await memory.initialize();
    if (initResult.issues && initResult.issues.length > 0) {
      console.warn("ui: browser-memory reported issues during initialize()", initResult.issues);
    }

    const resetRequested = new URLSearchParams(window.location.search).has("reset");
    if (resetRequested) {
      if (window.confirm(RESET_CONFIRM)) {
        await memory.clear();
        if (!store.clearAll({ keepLlm: true })) throw new Error("Local data could not be reset.");
        reloadApp();
        return;
      }
      const url = new URL(window.location.href);
      url.searchParams.delete("reset");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }

    profile = await memory.getProfile();
    applyFreeMerge(profile.region || DEFAULT_REGION);
    void runtime.setRegion(profile.region || DEFAULT_REGION).catch((err) => {
      console.warn("ui: could not set the catalog region.", err && err.message ? err.message : err);
    });
    const testMode = readTestMode(window.location);
    if (testMode) {
      profile = await memory.setProfile({
        ...profile,
        providers: testMode.providers,
        onboardingComplete: true
      });
    }
    subscriptions = new Set(profile.providers);
    updateRuntimeCatalogMetadata();

    const needsOnboarding = !profile.onboardingComplete && (!BYPASS_ONBOARDING || store.hasKey());
    if (needsOnboarding) {
      onboarding.show();
    } else {
      await showShell();
    }

    scheduleSidecar();
  } catch (err) {
    showError(err && err.message ? err.message : String(err));
  }
}

window.addEventListener("pagehide", () => runtime.dispose());
init();
