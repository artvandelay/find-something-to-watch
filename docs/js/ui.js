import { normalizeTitle, buildIndex, search, filterIndices, seedQueue } from "./catalog.js";
import { parseWatchHistoryExport, summarize } from "./history.js";
import { createHistoryPlanInferer } from "./history-model.js";
import { createTools } from "./tools.js";
import { runAgent } from "./agent.js";
import { createCatalogRuntime } from "./catalog-runtime.js";
import { createStore, DEFAULT_LLM } from "./store.js";
import { createBrowserMemory } from "./memory.js";
import {
  DEFAULT_RECOMMENDATION_REASON,
  defaultRecommendationQueue,
  sanitizeRecommendationQueue
} from "./recommendations.js";
import { mergeLearnedPreferences, renderLearnedContext } from "./preferences.js";
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

const DOM_IDS = [
  "app", "error-banner",
  "onboarding-screen", "onboarding-form", "onboarding-provider-list",
  "onboarding-title", "onboarding-progress", "onboarding-llm-api-key",
  "onboarding-history-file", "onboarding-history-summary", "onboarding-history-status",
  "onboarding-history-remove", "onboarding-back", "onboarding-next",
  "shell", "sidebar-toggle", "sidebar", "sidebar-collapse", "backdrop", "new-chat-btn",
  "conversation-list", "conversation-list-items", "subscriptions-summary", "playlists-btn", "context-btn",
  "settings-btn", "catalog-status",
  "workspace", "chat-region", "chat-transcript", "chat-note",
  "query-form", "query-input", "send-btn", "stop-btn",
  "queue-region", "queue-status", "queue-source", "queue-viewport", "queue-track", "queue-empty",
  "queue-top-pick", "queue-alternatives", "queue-more",
  "title-details-dialog", "title-details-close", "title-details-title", "title-details-content",
  "attribution",
  "settings-dialog", "settings-provider-list", "llm-base-url", "llm-api-key", "llm-model",
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

const KEYWORD_NOTE = "Keyword search — add an API key in Settings for ranked recommendations.";
const NO_KEY_REPLY_PREFIX = "Keyword matches (add an API key in Settings for a conversational, ranked search): ";

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
let index = null;
let richIndexReady = false;
let catalogRuntimeState = "BOOTING";
let catalogRuntimeError = null;

let profile = null;
let subscriptions = new Set();
let conversation = null;
let recommendationQueue = defaultRecommendationQueue();
let learned = null;
let playlists = null;

let controller = null;
let historyController = null;
let stateGeneration = 0;
let activeTurnId = null;

const runtime = createCatalogRuntime({
  onState(nextState) {
    catalogRuntimeState = nextState;
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
  const res = await fetch(url, { cache: "no-cache" });
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
  let line = count.toLocaleString("en-IN") + " titles · snapshot " + builtAt;
  if (!index) line += " · preparing search index…";
  else if (!richIndexReady) line += " · refining with synopses…";
  if (catalogRuntimeError) line += " · catalog analysis unavailable";
  queueView.setCatalogStatus(line);
  if (chat) {
    const runtimeNote = catalogRuntimeError
      ? "Catalog analysis is unavailable; keyword search remains available without an API key."
      : "";
    chat.setNote(runtimeNote || (!richIndexReady
      ? "Search is still refining with full synopses — results may be less precise for a moment."
      : ""));
    chat.setSendReady(Boolean(index));
  }
}

function refreshSendReadiness() {
  chat.setSendReady(Boolean(index));
}

/** Navigation and destructive local-data controls are locked during a turn. */
function setShellBusy(busy) {
  if (sidebar) sidebar.setBusy(busy);
  if (dialogs) dialogs.setBusy(busy);
}

function currentScope() {
  return { subscriptions: [...subscriptions] };
}

function runtimeIsReady() {
  return catalogRuntimeState === "READY_BASIC" || catalogRuntimeState === "READY_RICH";
}

function hasDeterministicAgent() {
  return typeof window.__OTT_TEST_RUN_AGENT__ === "function";
}

function runWhenIdle(run) {
  // A search index is required before the composer becomes usable. Browsers may
  // defer idle callbacks indefinitely while a page is busy, so bound the wait.
  if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(run, { timeout: 250 });
  else setTimeout(run, 0);
}

function scheduleIndex() {
  runWhenIdle(() => {
    try {
      index = buildIndex(records);
    } catch (err) {
      showError("Could not prepare the search index. " + (err && err.message ? err.message : ""));
    }
    updateCatalogStatusLine();
  });
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
        if (merged > 0) {
          await new Promise((resolve) => {
            runWhenIdle(() => {
              index = buildIndex(records);
              resolve();
            });
          });
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

function hydrate(id, reason = "") {
  const full = recordsById.get(id);
  if (!full) return null;
  const scoped = intersectProviders(full, subscriptions);
  if (scoped.p.length === 0) return null; // no longer available on current subscriptions
  return {
    id: scoped.id, t: scoped.t, y: scoped.y, k: scoped.k, rt: scoped.rt, r: scoped.r,
    p: scoped.p, l: scoped.l, g: scoped.g, u: scoped.u, img: scoped.img, s: scoped.s || "",
    reason
  };
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

function hydratedQueue() {
  return recommendationQueue.items.map((item) => hydrate(item.id, item.reason)).filter(Boolean);
}

function renderQueue() {
  const list = hydratedQueue();
  queueView.render(list, richIndexReady || index
    ? "Nothing queued for your current subscriptions yet."
    : "Still preparing the catalog…", recommendationQueue.source);
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

async function seedQueueIfEmpty() {
  if (conversation.messages.length > 0 || recommendationQueue.items.length > 0 || records.length === 0) return;
  let seenKeys = [];
  try {
    seenKeys = (await memory.getHistory())?.seen ?? [];
  } catch (err) {
    showError("Watch history is unavailable, so the initial picks may include watched titles.");
  }
  const ids = seedQueue(records, { providers: subscriptions, excludeKeys: seenKeys, limit: 20 });
  recommendationQueue = {
    ...defaultRecommendationQueue(),
    items: ids.map((id) => ({ id, reason: DEFAULT_RECOMMENDATION_REASON }))
  };
  try {
    const saved = await memory.saveConversationAndQueue(conversation, recommendationQueue);
    conversation = saved.conversation;
    recommendationQueue = saved.queue;
  } catch (err) {
    console.warn("ui: could not persist the seeded queue.", err && err.message ? err.message : err);
  }
  renderQueue();
}

function renderConversation() {
  chat.renderConversation(conversation.messages);
  void memory.getConversationList()
    .then((list) => sidebar.renderConversationList(list))
    .catch((error) => console.warn("ui: could not render conversations.", error));
}

// ---- Agent tools + submission -----------------------------------------------

function makeTools(seenKeys) {
  return createTools({
    runtime,
    scope: currentScope(),
    currentQueueIds: recommendationQueue.items.map((item) => item.id),
    seenKeys: Array.isArray(seenKeys) ? seenKeys : [],
  });
}

function makeTurnId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "turn-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

function sanitizeTraceText(value) {
  return String(value || "").replace(/[\r\n\t]+/g, " ").slice(0, 240);
}

function makeEventHandler({ turnId, turnGeneration, startedAt, onMeaningfulProgress }) {
  return function onEvent(event) {
    if (!event || typeof event !== "object" || event.turnId !== turnId ||
      turnGeneration !== stateGeneration || activeTurnId !== turnId) return;
    if (event.type === "status") {
      dialogs.appendTrace(sanitizeTraceText(event.phase || event.text));
      chat.setTurnStatus(event.phase || event.text || "Working");
      onMeaningfulProgress();
      return;
    }
    if (event.type === "tool_call") {
      dialogs.appendTrace("Catalog tool requested");
      chat.setTurnStatus("SEARCHING CATALOG");
      onMeaningfulProgress();
      return;
    }
    if (event.type === "tool_result") {
      dialogs.appendTrace("Catalog tool returned " + (Number.isFinite(event.count) ? event.count : 0) + " results");
      chat.addToolResult(event.count);
      chat.setTurnStatus("ANALYZING MATCHES");
      onMeaningfulProgress();
      return;
    }
    if (event.type === "delta") {
      chat.appendDelta(event.text);
      onMeaningfulProgress();
      return;
    }
    if (event.type === "error") {
      chat.failTurn(event);
    }
  };
}

async function runKeywordFallback(query, seenKeys) {
  if (!index) {
    index = buildIndex(records);
    updateCatalogStatusLine();
  }
  const allowed = new Set(filterIndices(records, {
    providers: subscriptions,
    excludeKeys: seenKeys
  }));
  const ids = search(index, query, { limit: 20, allow: allowed })
    .map((result) => records[result.i]?.id)
    .filter(Boolean);
  const turnId = "local-" + Date.now().toString(36);
  recommendationQueue = {
    ...defaultRecommendationQueue(),
    source: { conversationId: conversation.id, turnId, query: query.replace(/\s+/g, " ").trim().slice(0, 120) },
    items: ids.slice(0, 20).map((id) => ({ id, reason: DEFAULT_RECOMMENDATION_REASON }))
  };
  const replyText = NO_KEY_REPLY_PREFIX + (ids.length
    ? ids.map((id) => recordsById.get(id)?.t).filter(Boolean).slice(0, 5).join(", ")
    : "no matches in this catalog snapshot.");
  const saved = await memory.completeTurn(conversation.id, { content: replyText, queue: recommendationQueue });
  conversation = saved.conversation;
  recommendationQueue = saved.queue;
  renderConversation();
  renderQueue();
  chat.setNote(KEYWORD_NOTE);
}

async function onSubmit() {
  if (controller) return;
  const query = chat.getQuery();
  if (!query) return;

  clearError();
  const keyedTurn = store.hasKey();
  if (keyedTurn && !runtimeIsReady() && !hasDeterministicAgent()) {
    chat.setNote("Catalog analysis is still preparing. Try again in a moment.");
    return;
  }

  chat.clearQuery();
  const turnGeneration = stateGeneration;
  const priorMessages = conversation.messages.slice();
  try {
    const saved = await memory.appendUserMessage(conversation.id, query);
    conversation = saved.conversation;
    renderConversation();
  } catch (error) {
    showError(error && error.message ? error.message : "Could not save your message.");
    chat.setQuery(query);
    return;
  }

  let seenKeys = [];
  try {
    seenKeys = (await memory.getHistory())?.seen ?? [];
  } catch (err) {
    showError("Personalization data is unavailable; this search may include watched titles.");
  }

  if (!keyedTurn) {
    chat.setBusy(true);
    setShellBusy(true);
    try {
      await runKeywordFallback(query, seenKeys);
    } catch (err) {
      showError(err && err.message ? err.message : "Keyword search failed.");
    } finally {
      chat.setBusy(false);
      setShellBusy(false);
      refreshSendReadiness();
    }
    return;
  }

  const turnId = makeTurnId();
  const thisController = new AbortController();
  controller = thisController;
  activeTurnId = turnId;
  chat.setBusy(true);
  setShellBusy(true);
  dialogs.clearTrace();
  chat.startTurn();
  const startedAt = Date.now();
  let lastMeaningfulElapsed = 0;
  const activityTimer = window.setInterval(() => {
    if (turnGeneration !== stateGeneration || activeTurnId !== turnId) return;
    const elapsed = Math.max(0, Date.now() - startedAt);
    if (elapsed >= 1000) {
      const slow = elapsed - lastMeaningfulElapsed >= 20000;
      if (slow) chat.setTurnStatus("TAKING LONGER THAN USUAL");
      chat.setTurnElapsed(elapsed, { slow });
    }
  }, 250);
  const markProgress = () => { lastMeaningfulElapsed = Math.max(0, Date.now() - startedAt); };

  let youmd = "";
  let history = null;
  try {
    const [manualYoumd, savedHistory, savedLearned, savedProfile] = await Promise.all([
      memory.getYouMd(), memory.getHistory(), memory.getLearned(), memory.getProfile()
    ]);
    youmd = manualYoumd + (savedProfile.memoryEnabled === false ? "" : `\n\n${renderLearnedContext(savedLearned)}`);
    history = savedHistory;
  } catch (err) {
    showError("Personalization data is unavailable; continuing without saved context.");
  }

  try {
    const catalogManifest = hasDeterministicAgent()
      ? { count: records.length, providers: [...subscriptions] }
      : await runtime.describe({ scope: currentScope() });
    const runner = hasDeterministicAgent() ? window.__OTT_TEST_RUN_AGENT__ : runAgent;
    const result = await runner({
      config: store.getLlm(),
      prompts,
      tools: makeTools(seenKeys),
      context: { youmd, history, mood: "", catalogManifest },
      query,
      conversation: priorMessages,
      onEvent: makeEventHandler({ turnId, turnGeneration, startedAt, onMeaningfulProgress: markProgress }),
      signal: thisController.signal,
      turnId
    });

    if (turnGeneration !== stateGeneration || activeTurnId !== turnId) return;
    if (!result.ok) {
      return;
    }

    const replyText = result.reply || prompts.no_results || "I couldn't come up with anything this time.";
    let nextQueue = recommendationQueue;
    if (Array.isArray(result.queue)) {
      nextQueue = sanitizeRecommendationQueue({
        source: {
          conversationId: conversation.id,
          turnId,
          query
        },
        items: result.queue
      }) || recommendationQueue;
    }
    const nextLearned = Array.isArray(result.memoryCandidates) && profile?.memoryEnabled !== false
      ? mergeLearnedPreferences(learned || await memory.getLearned(), result.memoryCandidates, query)
      : learned;
    const saved = await memory.completeTurn(conversation.id, {
      content: replyText,
      queue: nextQueue,
      meta: {
        status: "complete",
        timing: result.timing,
        usage: result.usage,
        billing: result.billing
      },
      learned: nextLearned
    });
    conversation = saved.conversation;
    recommendationQueue = saved.queue;
    learned = saved.learned ?? nextLearned;
    renderQueue();
    chat.completeTurn({
      reply: replyText,
      timing: result.timing,
      usage: result.usage,
      billing: result.billing,
      catalogCount: typeof catalogMeta?.count === "number" ? catalogMeta.count : records.length
    });
  } catch (err) {
    if (turnGeneration === stateGeneration && activeTurnId === turnId) {
      chat.failTurn({ message: err && err.message ? err.message : "The search failed." });
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

function onStop() {
  if (!controller) return;
  chat.failTurn({ message: "Stopped." });
  cancelActiveTurn();
}

// ---- New chat / subscriptions / context / backup ---------------------------

function cancelActiveTurn() {
  stateGeneration += 1;
  if (controller) controller.abort();
  controller = null;
  activeTurnId = null;
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
    renderConversation();
    renderQueue();
    clearError();
  } catch (error) {
    showError(error && error.message ? error.message : "Could not open that conversation.");
  }
}

async function onSubscriptionsChange(newProviders) {
  cancelActiveTurn();
  profile = await memory.setProfile({ ...profile, providers: newProviders, onboardingComplete: true });
  subscriptions = new Set(profile.providers);
  updateRuntimeCatalogMetadata();
  sidebar.renderSubscriptions(profile.providers);
  renderQueue();
  renderPlaylists();
  titleDetailsView?.refresh();
  await seedQueueIfEmpty();
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
  sidebar.renderSubscriptions(profile.providers);
  renderConversation();
  renderQueue();
  renderPlaylists();
  titleDetailsView?.refresh();
  await seedQueueIfEmpty();
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
  void runtime.describe({ scope: currentScope() })
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
    onOpenPlaylists: () => playlistsView.openManager(),
    getCollapsed: () => store.getSidebarCollapsed(),
    setCollapsed: (collapsed) => store.setSidebarCollapsed(collapsed)
  });

  chat = createChatView(el, { onSubmit, onStop });

  titleDetailsView = createTitleDetailsView(el, { resolveDetails: resolveTitleDetails });

  queueView = createQueueView(el, {
    watchCta,
    onOpenPlaylistPicker: (titleId, title) => playlistsView.openPicker(titleId, title),
    onOpenTitleDetails: (titleId, trigger) => titleDetailsView.open(titleId, trigger)
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

    if (!profile.onboardingComplete) {
      onboarding.show();
    } else {
      await showShell();
    }

    scheduleIndex();
    scheduleSidecar();
  } catch (err) {
    showError(err && err.message ? err.message : String(err));
  }
}

window.addEventListener("pagehide", () => runtime.dispose());
init();
