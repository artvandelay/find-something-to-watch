import { normalizeTitle, buildIndex, search, filterIndices, seedQueue } from "./catalog.js";
import { parseWatchHistoryExport, summarize } from "./history.js";
import { createHistoryPlanInferer } from "./history-model.js";
import { createTools } from "./tools.js";
import { runAgent } from "./agent.js";
import { createStore, DEFAULT_LLM } from "./store.js";
import { createBrowserMemory } from "./memory.js";
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
  "shell", "sidebar-toggle", "sidebar", "backdrop", "new-chat-btn",
  "conversation-indicator", "subscriptions-summary", "playlists-btn", "context-btn",
  "settings-btn", "export-backup-btn", "import-backup-btn", "import-backup-file",
  "clear-data-btn", "catalog-status",
  "workspace", "chat-region", "chat-transcript", "chat-note",
  "query-form", "query-input", "send-btn", "stop-btn",
  "queue-region", "queue-status", "queue-viewport", "queue-track", "queue-prev",
  "queue-next", "queue-empty",
  "attribution",
  "settings-dialog", "settings-provider-list", "llm-base-url", "llm-api-key", "llm-model",
  "settings-feedback", "settings-save", "settings-close",
  "context-dialog", "youmd-input", "history-file", "history-summary", "history-remove",
  "context-feedback", "context-save", "context-close",
  "disclosure-dialog", "catalog-detail", "trace",
  "export-md", "export-json", "export-csv", "export-youmd", "disclosure-feedback",
  "disclosure-close",
  "playlists-dialog", "playlists-dialog-title", "playlists-close", "playlist-picker",
  "playlist-picker-title", "playlist-picker-list", "playlist-manager", "playlist-select",
  "playlist-items", "playlist-create-name", "playlist-create", "playlist-rename-name",
  "playlist-rename", "playlist-delete", "playlist-export-md", "playlist-export-json",
  "playlist-export-csv", "playlist-feedback"
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

let prompts = null;
let records = [];
let recordsById = new Map();
let catalogMeta = null;
let index = null;
let richIndexReady = false;

let profile = null;
let subscriptions = new Set();
let conversation = { schema: 1, updatedAt: null, messages: [] };
let queueIds = [];
let playlists = null;

let controller = null;
let historyController = null;
let stateGeneration = 0;

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
  sidebar.setCatalogStatus(line);
  if (chat) {
    chat.setNote(!richIndexReady ? "Search is still refining with full synopses — results may be less precise for a moment." : "");
    chat.setSendReady(Boolean(index));
  }
}

function refreshSendReadiness() {
  chat.setSendReady(Boolean(index));
}

function runWhenIdle(run) {
  if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(run);
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

function hydrate(id) {
  const full = recordsById.get(id);
  if (!full) return null;
  const scoped = intersectProviders(full, subscriptions);
  if (scoped.p.length === 0) return null; // no longer available on current subscriptions
  return {
    id: scoped.id, t: scoped.t, y: scoped.y, k: scoped.k, rt: scoped.rt, r: scoped.r,
    p: scoped.p, l: scoped.l, g: scoped.g, u: scoped.u, img: scoped.img, s: scoped.s || "",
    reason: ""
  };
}

function hydratedQueue() {
  return queueIds.map(hydrate).filter(Boolean);
}

function renderQueue() {
  const list = hydratedQueue();
  queueView.render(list, richIndexReady || index
    ? "Nothing queued for your current subscriptions yet."
    : "Still preparing the catalog…");
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
  if (conversation.messages.length > 0 || queueIds.length > 0 || records.length === 0) return;
  let seenKeys = [];
  try {
    seenKeys = (await memory.getHistory())?.seen ?? [];
  } catch (err) {
    showError("Watch history is unavailable, so the initial picks may include watched titles.");
  }
  queueIds = seedQueue(records, { providers: subscriptions, excludeKeys: seenKeys, limit: 20 });
  try {
    const saved = await memory.saveConversationAndQueue(conversation, { ids: queueIds });
    conversation = saved.conversation;
    queueIds = saved.queue.ids;
  } catch (err) {
    console.warn("ui: could not persist the seeded queue.", err && err.message ? err.message : err);
  }
  renderQueue();
}

function renderConversation() {
  chat.renderConversation(conversation.messages);
  sidebar.renderConversationIndicator(conversation.messages.length);
}

// ---- Agent tools + submission -----------------------------------------------

function makeTools(seenKeys) {
  return createTools({
    records,
    index,
    search,
    filterIndices,
    normalizeTitle,
    seenKeys: Array.isArray(seenKeys) ? seenKeys : [],
    subscriptions,
    recordsById
  });
}

function makeEventHandler() {
  return function onEvent(event) {
    if (!event || typeof event !== "object") return;
    if (event.type === "status") {
      dialogs.appendTrace(event.text || "");
      chat.setNote(event.text || "");
      return;
    }
    if (event.type === "tool_call") {
      dialogs.appendTrace(event.name + " " + JSON.stringify(event.args || {}));
      return;
    }
    if (event.type === "tool_result") {
      dialogs.appendTrace(event.name + " → " + (event.count ?? 0) + " results");
      return;
    }
    if (event.type === "error") {
      chat.setNote("");
      showError(event.message || "Something went wrong.");
    }
  };
}

async function runKeywordFallback(query, seenKeys) {
  const tools = makeTools(seenKeys);
  const result = await tools.handlers.search_titles({ query, exclude_seen: seenKeys.length > 0, limit: 20 });
  const ids = (result.results || []).map((r) => r.id);
  queueIds = ids.slice(0, 20);
  const replyText = NO_KEY_REPLY_PREFIX + (ids.length
    ? ids.map((id) => recordsById.get(id)?.t).filter(Boolean).slice(0, 5).join(", ")
    : "no matches in this catalog snapshot.");
  conversation.messages.push({ role: "assistant", content: replyText, createdAt: new Date().toISOString() });
  const saved = await memory.saveConversationAndQueue(conversation, { ids: queueIds });
  conversation = saved.conversation;
  queueIds = saved.queue.ids;
  renderConversation();
  renderQueue();
  chat.setNote(KEYWORD_NOTE);
}

async function onSubmit() {
  if (controller) return;
  const query = chat.getQuery();
  if (!query) return;
  if (!index) {
    chat.setNote("Still preparing the catalog — try again in a moment.");
    return;
  }

  clearError();
  chat.clearQuery();
  const turnGeneration = stateGeneration;
  const previousConversation = {
    ...conversation,
    messages: conversation.messages.slice()
  };
  chat.appendMessage("user", query);
  conversation.messages.push({ role: "user", content: query, createdAt: new Date().toISOString() });
  const priorMessages = conversation.messages.slice(0, -1);

  let seenKeys = [];
  try {
    seenKeys = (await memory.getHistory())?.seen ?? [];
  } catch (err) {
    showError("Personalization data is unavailable; this search may include watched titles.");
  }

  if (!store.hasKey()) {
    chat.setBusy(true);
    sidebar.setBusy(true);
    try {
      await runKeywordFallback(query, seenKeys);
    } catch (err) {
      if (turnGeneration === stateGeneration) {
        conversation = previousConversation;
        renderConversation();
        chat.setQuery(query);
      }
      showError(err && err.message ? err.message : "Keyword search failed.");
    } finally {
      chat.setBusy(false);
      sidebar.setBusy(false);
      refreshSendReadiness();
    }
    return;
  }

  const thisController = new AbortController();
  controller = thisController;
  chat.setBusy(true);
  sidebar.setBusy(true);
  dialogs.clearTrace();

  let youmd = "";
  let history = null;
  try {
    [youmd, history] = await Promise.all([memory.getYouMd(), memory.getHistory()]);
  } catch (err) {
    showError("Personalization data is unavailable; continuing without saved context.");
  }

  try {
    const result = await runAgent({
      config: store.getLlm(),
      prompts,
      tools: makeTools(seenKeys),
      context: { youmd, history, mood: "" },
      query,
      conversation: priorMessages,
      onEvent: makeEventHandler(),
      signal: thisController.signal
    });

    if (turnGeneration !== stateGeneration) return;
    if (!result.ok) {
      conversation = previousConversation;
      renderConversation();
      chat.setQuery(query);
      return;
    }

    const replyText = result.reply || prompts.no_results || "I couldn't come up with anything this time.";
    conversation.messages.push({ role: "assistant", content: replyText, createdAt: new Date().toISOString() });

    if (Array.isArray(result.queue)) {
      queueIds = result.queue.slice(0, 20);
    }
    const saved = await memory.saveConversationAndQueue(conversation, { ids: queueIds });
    conversation = saved.conversation;
    queueIds = saved.queue.ids;
    renderConversation();
    renderQueue();
    chat.setNote("");
  } catch (err) {
    if (turnGeneration === stateGeneration) {
      conversation = previousConversation;
      renderConversation();
      chat.setQuery(query);
    }
    showError(err && err.message ? err.message : "The search failed.");
  } finally {
    if (controller === thisController) {
      controller = null;
      chat.setBusy(false);
      sidebar.setBusy(false);
      refreshSendReadiness();
    }
  }
}

function onStop() {
  if (controller) controller.abort();
}

// ---- New chat / subscriptions / context / backup ---------------------------

function cancelActiveTurn() {
  stateGeneration += 1;
  if (controller) controller.abort();
  controller = null;
  if (chat) {
    chat.setBusy(false);
    refreshSendReadiness();
  }
  if (sidebar) sidebar.setBusy(false);
}

function cancelActiveOperations() {
  cancelActiveTurn();
  cancelActiveHistoryImport();
}

async function onNewChat() {
  cancelActiveTurn();
  conversation = { schema: 1, updatedAt: null, messages: [] };
  queueIds = [];
  renderConversation();
  await seedQueueIfEmpty();
  updateCatalogStatusLine();
  clearError();
}

async function onSubscriptionsChange(newProviders) {
  cancelActiveTurn();
  profile = await memory.setProfile({ ...profile, providers: newProviders, onboardingComplete: true });
  subscriptions = new Set(profile.providers);
  sidebar.renderSubscriptions(profile.providers);
  renderQueue();
  renderPlaylists();
  await seedQueueIfEmpty();
}

function exportMeta() {
  return { query: conversation.messages.filter((m) => m.role === "user").at(-1)?.content || "", generatedAt: new Date().toISOString() };
}

function getExportPicks() {
  return hydratedQueue();
}

async function onExportBackup() {
  try {
    const backup = await memory.exportBackup();
    downloadText("memory.json", "application/json;charset=utf-8", JSON.stringify(backup, null, 2));
  } catch (err) {
    showError("Could not export a backup. " + (err && err.message ? err.message : ""));
  }
}

async function onImportBackup(file) {
  cancelActiveOperations();
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const parsed = JSON.parse(String(reader.result || ""));
      await memory.importBackup(parsed);
      await reloadFromMemory();
      clearError();
    } catch (err) {
      showError("Could not import that backup. " + (err && err.message ? err.message : ""));
    }
  };
  reader.onerror = () => showError("Could not read that backup file.");
  reader.readAsText(file);
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
  const queue = await memory.getQueue();
  queueIds = queue.ids;
  playlists = await memory.getPlaylists();
  sidebar.renderSubscriptions(profile.providers);
  renderConversation();
  renderQueue();
  renderPlaylists();
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
  sidebar && sidebar.setCatalogStatus("Loading catalog…");
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

async function init() {
  el = collectDom();
  if (!el) return;

  dialogs = createDialogs(el, {
    providerOrder,
    store,
    getProfile: () => memory.getProfile(),
    getYouMd: () => memory.getYouMd(),
    setYouMd: (v) => memory.setYouMd(v),
    getHistory: () => memory.getHistory(),
    setHistory: (v) => memory.setHistory(v),
    summarizeHistory: summarize,
    importHistoryFile,
    onSubscriptionsChange,
    catalogMeta: () => catalogMeta,
    getExportPicks,
    exportMeta,
    onError: showError
  });

  sidebar = createSidebarView(el, {
    providerLabel,
    onNewChat,
    onOpenPlaylists: () => playlistsView.openManager(),
    onExportBackup,
    onImportBackup,
    onClearData
  });

  chat = createChatView(el, { onSubmit, onStop });

  queueView = createQueueView(el, {
    watchCta,
    onOpenPlaylistPicker: (titleId, title) => playlistsView.openPicker(titleId, title)
  });

  playlistsView = createPlaylistsView(el, {
    onToggle: onPlaylistToggle,
    onRemove: (playlistId, titleId) => savePlaylistMutation((state) =>
      removeFromPlaylist(state, playlistId, titleId)),
    onCreate: (name) => savePlaylistMutation((state) => createPlaylist(state, name)),
    onRename: (playlistId, name) => savePlaylistMutation((state) =>
      renamePlaylist(state, playlistId, name)),
    onDelete: (playlistId) => savePlaylistMutation((state) => deletePlaylist(state, playlistId)),
    onExport: onPlaylistExport
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

init();
