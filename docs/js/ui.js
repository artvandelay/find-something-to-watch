import { normalizeTitle, seedQueue } from "./catalog.js";
import { parseWatchHistoryExport, summarize } from "./history.js";
import { createHistoryPlanInferer } from "./history-model.js";
import { createTools } from "./tools.js";
import { runAgent } from "./agent.js";
import { createCatalogRuntime } from "./catalog-runtime.js";
import { createStore, DEFAULT_LLM } from "./store.js";
import { createBrowserMemory } from "./memory.js";
import {
  DEFAULT_RECOMMENDATION_REASON,
  allowsRewatch,
  defaultRecommendationQueue,
  sanitizeRecommendationQueue
} from "./recommendations.js";
import { mergeLearnedPreferences, renderLearnedContext, upsertLearnedPreference } from "./preferences.js";
import { providerLabel, watchCta, intersectProviders, DEFAULT_PROVIDER_ORDER } from "./providers.js";
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
import { createDialogs } from "./views/dialogs.js";
import { createPlaylistsView } from "./views/playlists.js";
import { createTitleDetailsView } from "./views/title-details.js";
import { downloadText } from "./views/dom.js";
import { readTestMode } from "./test-mode.js";

const store = createStore(window.localStorage);
const memory = createBrowserMemory({ onIssue: (issue) => console.warn("ui: browser-memory issue", issue) });

// Keep onboarding available while the app opens directly into chat. Set this
// to false to restore the profile-based first-run flow.
const BYPASS_ONBOARDING = true;

const DOM_IDS = [
  "app", "error-banner",
  "onboarding-screen", "onboarding-form", "onboarding-provider-list",
  "onboarding-title", "onboarding-progress", "onboarding-llm-api-key",
  "onboarding-history-file", "onboarding-history-summary", "onboarding-history-status",
  "onboarding-history-remove", "onboarding-back", "onboarding-next",
  "shell", "sidebar-toggle", "sidebar", "sidebar-collapse", "backdrop", "new-chat-btn",
  "conversation-list", "conversation-list-items", "subscriptions-summary", "subscriptions-edit",
  "playlists-btn", "context-btn", "settings-btn", "catalog-status",
  "workspace", "chat-region", "chat-transcript", "chat-key-error", "chat-note",
  "query-form", "query-input", "send-btn", "stop-btn",
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
  "llm-web-search", "export-backup-btn", "clear-data-btn",
  "settings-feedback", "settings-save", "settings-close",
  "context-dialog", "youmd-input", "history-file", "history-summary", "history-remove",
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
let displayCatalogReady = false;
let richIndexReady = false;
let catalogRuntimeState = "BOOTING";
let catalogRuntimeError = null;
let cachedCatalogManifest = null;
let cachedCatalogManifestKey = null;

let profile = null;
let subscriptions = new Set();
let conversation = null;
let recommendationQueue = defaultRecommendationQueue();
let learned = null;
let playlists = null;
let seenKeysCache = [];

let controller = null;
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
  const order = catalogMeta && Array.isArray(catalogMeta.provider_order) ? catalogMeta.provider_order : null;
  return order && order.length > 0 ? order : DEFAULT_PROVIDER_ORDER;
}

function cancelActiveHistoryImport() {
  if (historyController) historyController.abort();
  historyController = null;
}

async function importHistoryFile(file, { signal = null, onStatus = null } = {}) {
  if (!file || typeof file.arrayBuffer !== "function") {
    throw new Error("Could not read that watch-history file.");
  }

  cancelActiveTurn();
  cancelActiveHistoryImport();
  const activeController = new AbortController();
  historyController = activeController;
  const abortFromCaller = () => activeController.abort();
  if (signal) signal.addEventListener("abort", abortFromCaller, { once: true });
  const status = typeof onStatus === "function" ? onStatus : () => {};

  try {
    status("Reading watch history locally…");
    const bytes = await file.arrayBuffer();
    if (activeController.signal.aborted) {
      const error = new Error("The history import was cancelled.");
      error.name = "AbortError";
      throw error;
    }
    if (!prompts || typeof prompts.history_plan !== "string") {
      throw new Error("The history import prompt is unavailable.");
    }
    status("Inferring the file layout from a bounded sample…");
    const inferPlan = createHistoryPlanInferer({
      config: store.getLlm(),
      prompt: prompts.history_plan
    });
    const history = await parseWatchHistoryExport(
      { name: file.name, bytes },
      { inferPlan, signal: activeController.signal }
    );
    status("Watch history imported.");
    return history;
  } finally {
    if (signal) signal.removeEventListener("abort", abortFromCaller);
    if (historyController === activeController) historyController = null;
  }
}

// ---- Catalog + search index readiness -------------------------------------

function updateCatalogStatusLine() {
  const count = typeof (catalogMeta && catalogMeta.count) === "number" ? catalogMeta.count : records.length;
  const builtAt = String((catalogMeta && catalogMeta.built_at) || "").slice(0, 10);
  let line = count.toLocaleString("en-IN") + " titles";
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
}

function currentScope() {
  return { subscriptions: [...subscriptions] };
}

function catalogManifestCacheKey(scope = currentScope()) {
  const subscriptions = Array.isArray(scope.subscriptions) ? scope.subscriptions : [];
  return subscriptions
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
    return { count: records.length, providers: [...subscriptions] };
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
    seenKeysCache = (await memory.getHistory())?.seen ?? [];
  } catch {
    seenKeysCache = [];
  }
  return seenKeysCache;
}

function hydrate(id, reason = "", { includeWatched = false } = {}) {
  const full = recordsById.get(id);
  if (!full) return null;
  const scoped = intersectProviders(full, subscriptions);
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
      subscribed: subscriptions.has(slug),
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

function renderQueue() {
  const list = hydratedQueue();
  let emptyText = "Still preparing the catalog…";
  if (displayCatalogReady) {
    emptyText = subscriptions.size === 0
      ? "Choose subscriptions in Settings to fill your picks."
      : "Nothing queued for your current subscriptions yet.";
  }
  queueView.render(list, emptyText, recommendationQueue.source);
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
    ids = seedQueue(records, { providers: subscriptions, excludeKeys: seenKeys, limit: 20 });
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

function renderConversation() {
  chat.renderConversation(conversation.messages);
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
  const genre = Array.isArray(rec?.g) ? rec.g.find((value) => typeof value === "string" && value.trim()) : "";
  if (genre) {
    return { kind: "genre", polarity, value: String(genre).trim().slice(0, 80) };
  }
  const title = typeof rec?.t === "string" ? rec.t.trim().slice(0, 80) : "";
  if (title) return { kind: "theme", polarity, value: title };
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

async function markTitleSeen(rec) {
  const title = typeof rec?.t === "string" ? rec.t.trim() : "";
  const key = normalizeTitle(title);
  if (!key) return;
  const now = new Date().toISOString();
  const existing = await memory.getHistory();
  if (!existing) {
    await memory.setHistory({
      schema: 2,
      importedAt: now,
      sources: [{ name: "Marked in picks", kind: "manual" }],
      series: rec?.k === "tv" ? [{ name: title, episodes: 1, lastWatched: null }] : [],
      movies: rec?.k === "tv" ? [] : [{ title, lastWatched: null }],
      other: [],
      seen: [key]
    });
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
      seen: Array.from(seen).sort()
    });
  }
  await refreshSeenKeys();
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
    if (action === "tonight") {
      await removeTitleFromQueue(titleId);
      queueView?.setFeedbackNote("Skipped for tonight.");
    }
  } catch (error) {
    showError(error && error.message ? error.message : "Could not save that feedback.");
  }
}

function userFacingMilestone(phase, text) {
  const raw = String(text || phase || "").trim();
  const key = String(phase || text || "").trim().toUpperCase();
  if (key === "PLANNING" || /checking your services/i.test(raw)) return "Checking your services";
  if (key === "SEARCHING CATALOG" || /searching/i.test(raw)) return "Searching the catalog";
  if (key === "ANALYZING MATCHES" || /comparing matches/i.test(raw)) return "Comparing matches";
  if (key === "WRITING" || /writing your picks|answering/i.test(raw)) {
    return /answering/i.test(raw) ? "Answering about your pick" : "Writing your picks";
  }
  if (/taking longer/i.test(raw)) return "Still working — this is taking longer than usual";
  return raw || "Working";
}

function makeEventHandler({ turnId, turnGeneration, startedAt, onMeaningfulProgress, onFirstVisibleToken }) {
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
      chat.failTurn(event);
    }
  };
}

async function onSubmit() {
  if (controller) return;
  if (!store.hasKey()) {
    refreshSendReadiness();
    return;
  }
  const query = chat.getQuery();
  if (!query) return;
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

  chat.clearQuery();
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
    showError(error && error.message ? error.message : "Could not save your message.");
    chat.setQuery(query);
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
  chat.setTurnStatus(userFacingMilestone("PLANNING"));
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
  let catalogManifest = { count: records.length, providers: [...subscriptions] };

  try {
    // IndexedDB personalization and the subscription-scoped catalog manifest are
    // independent; start both immediately and join only when building agent context.
    const contextTiming = turnTiming.start("indexeddb_context");
    const manifestTiming = turnTiming.start("catalog_manifest");
    const contextPromise = Promise.all([
      memory.getYouMd(),
      memory.getHistory(),
      memory.getLearned(),
      memory.getProfile()
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

    if (contextResult.status === "fulfilled") {
      const [manualYoumd, savedHistory, savedLearned, savedProfile] = contextResult.value;
      youmd = manualYoumd + (savedProfile.memoryEnabled === false ? "" : `\n\n${renderLearnedContext(savedLearned)}`);
      history = savedHistory;
      seenKeys = savedHistory?.seen ?? [];
      seenKeysCache = seenKeys;
    } else {
      showError("Personalization data is unavailable; continuing without saved context.");
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
    const runner = hasDeterministicAgent() ? window.__OTT_TEST_RUN_AGENT__ : runAgent;
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
      prompts,
      tools: makeTools(includeWatched ? [] : seenKeys, currentQueue?.items || []),
      context: {
        youmd,
        history,
        mood: "",
        catalogManifest,
        recommendationQueue: currentQueue
      },
      query,
      conversation: priorMessages,
      onEvent: makeEventHandler({
        turnId,
        turnGeneration,
        startedAt,
        onMeaningfulProgress: markProgress,
        onFirstVisibleToken: () => {
          if (firstVisibleTokenRecorded) return;
          firstVisibleTokenRecorded = true;
          turnTiming.point("first_visible_token");
        }
      }),
      signal: thisController.signal,
      turnId
    });

    if (turnGeneration !== stateGeneration || activeTurnId !== turnId) return;
    const timing = finalizeTiming(result.timing);
    const metricsTiming = result.timing && Number.isFinite(result.timing.totalMs) ? result.timing : timing;
    if (!result.ok) {
      appendTelemetryTrace({ timing: metricsTiming, usage: result.usage, billing: result.billing });
      chat.failTurn({ message: "The turn did not complete.", timing: metricsTiming });
      await rollbackPendingUserTurn(conversation.id, pendingUser);
      chat.restoreQueryIfEmpty(query);
      return;
    }

    const replyText = result.reply || prompts.no_results || "I couldn't come up with anything this time.";
    let nextQueue = recommendationQueue;
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
        nextQueue = {
          ...grounded,
          items: filterQueueItems(grounded.items, { includeWatched })
        };
      }
    }
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
      learned: nextLearned
    });
    conversation = saved.conversation;
    activePendingUser = null;
    recommendationQueue = saved.queue;
    learned = saved.learned ?? nextLearned;
    renderQueue();
    appendTelemetryTrace({ timing: metricsTiming, usage: result.usage, billing: result.billing });
    chat.completeTurn({
      reply: replyText,
      timing: metricsTiming,
      catalogCount: typeof catalogMeta?.count === "number" ? catalogMeta.count : records.length
    });
    const learnedNote = describeLearnedChange(priorLearned, learned);
    if (learnedNote) queueView?.setFeedbackNote(learnedNote);
  } catch (err) {
    if (turnGeneration === stateGeneration && activeTurnId === turnId) {
      await rollbackPendingUserTurn(conversation.id, pendingUser);
      const timing = finalizeTiming();
      appendTelemetryTrace({ timing });
      chat.failTurn({
        message: err && err.message ? err.message : "The search failed.",
        timing
      });
      chat.restoreQueryIfEmpty(query);
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
  chat.failTurn({ message: "Stopped.", status: "Stopped" });
  cancelActiveTurn();
  await rollbackPendingUserTurn(conversationId, pendingUser);
  chat.restoreQueryIfEmpty(pendingUser?.content);
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
    showError(error && error.message ? error.message : "Could not open that conversation.");
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

async function onSubscriptionsChange(newProviders) {
  cancelActiveTurn();
  profile = await memory.setProfile({ ...profile, providers: newProviders, onboardingComplete: true });
  subscriptions = new Set(profile.providers);
  invalidateCatalogManifestCache();
  updateRuntimeCatalogMetadata();
  sidebar.renderSubscriptions(profile.providers);
  renderPlaylists();
  titleDetailsView?.refresh();
  await refreshSeenKeys();
  if (conversation.messages.length === 0) {
    // Empty chats should rebuild the seed for the new subscription scope.
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
  return saved;
}

async function onExportBackup() {
  try {
    const backup = await memory.exportBackup();
    downloadText("memory.json", "application/json;charset=utf-8", JSON.stringify(backup, null, 2));
  } catch (err) {
    showError("Could not export a backup. " + (err && err.message ? err.message : ""));
  }
}

async function onClearData() {
  if (!window.confirm("Clear all local data? This removes your conversation, queue, subscriptions, You.md, watch history, and LLM key from this browser and cannot be undone.")) {
    return;
  }
  try {
    cancelActiveOperations();
    await memory.clear();
    if (!store.clearAll()) throw new Error("The saved API key could not be removed.");
    location.reload();
  } catch (err) {
    showError("Could not clear local data. " + (err && err.message ? err.message : ""));
  }
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
    onboardingComplete: true
  });
  subscriptions = new Set(profile.providers);
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
  records = Array.isArray(catalogDoc.records) ? catalogDoc.records : [];
  recordsById = new Map();
  for (const rec of records) recordsById.set(rec.id, rec);
  catalogMeta = catalogDoc.meta || {};
  // Main thread keeps display/resolve projections only; the Worker owns search indexing.
  displayCatalogReady = records.length > 0;
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
    getHistory: () => memory.getHistory(),
    setHistory: (v) => memory.setHistory(v),
    summarizeHistory: summarize,
    importHistoryFile,
    onSubscriptionsChange,
    catalogMeta: () => catalogMeta,
    getExportPicks,
    exportMeta,
    onExportBackup,
    onClearData,
    onError: showError
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

  chat = createChatView(el, { onSubmit, onStop });

  titleDetailsView = createTitleDetailsView(el, { resolveDetails: resolveTitleDetails });

  queueView = createQueueView(el, {
    watchCta,
    onOpenPlaylistPicker: (titleId, title) => playlistsView.openPicker(titleId, title),
    onOpenTitleDetails: (titleId, trigger) => titleDetailsView.open(titleId, trigger),
    onFeedback: onPickFeedback
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
    importHistoryFile,
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

    profile = await memory.getProfile();
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

    if (!BYPASS_ONBOARDING && !profile.onboardingComplete) {
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
