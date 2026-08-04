import { createCatalogRuntime } from "./catalog-runtime.js";
import { parseNetflixCsv, summarize } from "./history.js";
import { createTools } from "./tools.js";
import { runAgent } from "./agent.js";
import { createStore } from "./store.js";
import { createBrowserMemory } from "./memory.js";
import { providerLabel, languageLabel, watchCta, DEFAULT_PROVIDER_ORDER } from "./providers.js";
import { createOnboardingView } from "./views/onboarding.js";
import { createSidebarView } from "./views/sidebar.js";
import { createChatView } from "./views/chat.js";
import { createQueueView } from "./views/queue.js";
import { createDialogs } from "./views/dialogs.js";
import { downloadText } from "./views/dom.js";

const store = createStore(window.localStorage);
const memory = createBrowserMemory({ onIssue: (issue) => console.warn("ui: browser-memory issue", issue) });

const DOM_IDS = [
  "app", "error-banner",
  "onboarding-screen", "onboarding-form", "onboarding-provider-list",
  "onboarding-llm-base-url", "onboarding-llm-api-key", "onboarding-llm-model", "onboarding-web-search",
  "onboarding-youmd-input", "onboarding-history-file", "onboarding-history-summary",
  "onboarding-continue",
  "shell", "sidebar-toggle", "sidebar", "backdrop", "new-chat-btn",
  "conversation-indicator", "subscriptions-summary", "context-btn", "settings-btn",
  "disclosure-btn", "export-backup-btn", "import-backup-btn", "import-backup-file",
  "clear-data-btn", "catalog-status",
  "workspace", "chat-region", "chat-transcript", "chat-note",
  "query-form", "query-input", "mood-select", "language-select", "genre-select",
  "provider-select", "send-btn", "stop-btn",
  "queue-region", "queue-status", "queue-viewport", "queue-track", "queue-prev",
  "queue-next", "queue-empty",
  "attribution",
  "settings-dialog", "settings-provider-list", "llm-base-url", "llm-api-key", "llm-model", "llm-web-search",
  "settings-feedback", "settings-save", "settings-close",
  "context-dialog", "youmd-input", "history-file", "history-summary", "history-remove",
  "context-feedback", "context-save", "context-close",
  "disclosure-dialog", "catalog-detail", "trace",
  "export-md", "export-json", "export-csv", "export-youmd", "disclosure-feedback",
  "disclosure-close"
];

const KEYWORD_NOTE = "Keyword search — add an API key in Settings for ranked recommendations.";
const NO_KEY_REPLY_PREFIX = "Keyword matches (add an API key in Settings for a conversational, ranked search): ";

let el = null;
let dialogs = null;
let sidebar = null;
let chat = null;
let queueView = null;
let onboarding = null;

let prompts = null;
let catalogMeta = null;
let catalogState = "BOOTING";
let resolvedQueueCards = [];

let profile = null;
let subscriptions = new Set();
let conversation = { schema: 1, updatedAt: null, messages: [] };
let queueIds = [];

let controller = null;
let stateGeneration = 0;
const runtime = createCatalogRuntime({ onState: onCatalogState });

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

function subscribedOrder() {
  return providerOrder().filter((slug) => subscriptions.has(slug));
}

function readCsvFile(file, onDone) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = parseNetflixCsv(String(reader.result || ""));
      onDone(parsed, summarize(parsed));
    } catch (err) {
      onDone(null, err && err.message ? err.message : "Could not read that CSV.");
    }
  };
  reader.onerror = () => onDone(null, "Could not read that file.");
  reader.readAsText(file);
}

// ---- Catalog runtime / trusted hydration -----------------------------------

function runtimeReady() {
  return catalogState === "READY_BASIC" || catalogState === "READY_RICH";
}

function currentScope() {
  return {
    subscriptions: [...subscriptions],
    filters: chat ? chat.facetFilters() : {}
  };
}

function applyCatalogMeta(manifest) {
  if (!manifest || typeof manifest !== "object") return;
  const meta = manifest.meta && typeof manifest.meta === "object" ? manifest.meta : manifest;
  if (meta.region || meta.built_at || meta.count || meta.providers) {
    catalogMeta = { ...(catalogMeta || {}), ...meta };
  }
}

async function refreshCatalogMeta() {
  if (!runtimeReady()) return;
  const manifest = await runtime.describe(currentScope());
  applyCatalogMeta(manifest);
}

function updateCatalogStatusLine() {
  if (!sidebar) return;
  const count = typeof (catalogMeta && catalogMeta.count) === "number" ? catalogMeta.count : 0;
  const builtAt = String((catalogMeta && catalogMeta.built_at) || "").slice(0, 10);
  let line = count ? count.toLocaleString("en-IN") + " titles" : "Catalog";
  if (builtAt) line += " · snapshot " + builtAt;
  if (catalogState === "BOOTING" || catalogState === "RESTARTING") line += " · preparing search index…";
  else if (catalogState === "READY_BASIC") line += " · refining with synopses…";
  sidebar.setCatalogStatus(line);
  if (chat) {
    chat.setNote(catalogState === "READY_BASIC"
      ? "Search is still refining with full synopses — results may be less precise for a moment."
      : "");
    chat.setSendReady(runtimeReady());
  }
}

function refreshSendReadiness() {
  if (chat) chat.setSendReady(runtimeReady());
}

function onCatalogState(event) {
  const state = typeof event === "string" ? event : event && event.state;
  if (!state) return;
  catalogState = state;
  applyCatalogMeta(event && event.detail);
  updateCatalogStatusLine();
}

// ---- Hydration / rendering --------------------------------------------------

async function renderQueue(expectedGeneration = stateGeneration) {
  if (!runtimeReady()) {
    queueView.render([], "Still preparing the catalog…");
    return;
  }
  try {
    const cards = await runtime.resolve({ ids: queueIds, scope: currentScope() });
    if (expectedGeneration !== stateGeneration) return;
    resolvedQueueCards = Array.isArray(cards) ? cards : [];
    queueView.render(resolvedQueueCards, "Nothing queued for your current subscriptions yet.");
  } catch (err) {
    if (expectedGeneration !== stateGeneration) return;
    console.warn("ui: could not hydrate queue.", err && err.message ? err.message : err);
    queueView.render(resolvedQueueCards, "Could not refresh recommendations for your current subscriptions.");
  }
}

async function seedQueueIfEmpty() {
  if (conversation.messages.length > 0 || queueIds.length > 0 || !runtimeReady()) return;
  let seenKeys = [];
  try {
    seenKeys = (await memory.getHistory())?.seen ?? [];
  } catch (err) {
    showError("Watch history is unavailable, so the initial picks may include watched titles.");
  }
  const cards = await runtime.seedQueue({ scope: currentScope(), excludeKeys: seenKeys, limit: 20 });
  resolvedQueueCards = Array.isArray(cards) ? cards : [];
  queueIds = resolvedQueueCards.map((card) => card.id).filter(Boolean).slice(0, 20);
  try {
    const saved = await memory.saveConversationAndQueue(conversation, { ids: queueIds });
    conversation = saved.conversation;
    queueIds = saved.queue.ids;
  } catch (err) {
    console.warn("ui: could not persist the seeded queue.", err && err.message ? err.message : err);
  }
  queueView.render(resolvedQueueCards, "Nothing queued for your current subscriptions yet.");
}

function renderConversation() {
  chat.renderConversation(conversation.messages);
  sidebar.renderConversationIndicator(conversation.messages.length);
}

// ---- Agent tools + submission -----------------------------------------------

function makeTools(seenKeys) {
  return createTools({
    runtime,
    scope: currentScope(),
    currentQueueIds: queueIds,
    seenKeys: Array.isArray(seenKeys) ? seenKeys : []
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
  const cards = await runtime.keywordSearch({
    query,
    scope: currentScope(),
    excludeKeys: seenKeys,
    limit: 20
  });
  resolvedQueueCards = Array.isArray(cards) ? cards : [];
  const ids = resolvedQueueCards.map((card) => card.id).filter(Boolean).slice(0, 20);
  queueIds = ids;
  const replyText = NO_KEY_REPLY_PREFIX + (ids.length
    ? resolvedQueueCards.map((card) => card.t).filter(Boolean).slice(0, 5).join(", ")
    : "no matches in this catalog snapshot.");
  conversation.messages.push({ role: "assistant", content: replyText, createdAt: new Date().toISOString() });
  const saved = await memory.saveConversationAndQueue(conversation, { ids: queueIds });
  conversation = saved.conversation;
  queueIds = saved.queue.ids;
  renderConversation();
  queueView.render(resolvedQueueCards, "Nothing queued for your current subscriptions yet.");
  chat.setNote(KEYWORD_NOTE);
}

async function onSubmit() {
  if (controller) return;
  const query = chat.getQuery();
  if (!query) return;
  if (!runtimeReady()) {
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
    const catalogManifest = await runtime.describe(currentScope());
    applyCatalogMeta(catalogManifest);
    const result = await runAgent({
      config: store.getLlm(),
      prompts,
      tools: makeTools(seenKeys),
      context: { youmd, history, mood: chat.getMood(), catalogManifest },
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
    await renderQueue(turnGeneration);
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

async function onNewChat() {
  cancelActiveTurn();
  conversation = { schema: 1, updatedAt: null, messages: [] };
  queueIds = [];
  resolvedQueueCards = [];
  renderConversation();
  await seedQueueIfEmpty();
  updateCatalogStatusLine();
  clearError();
}

async function onSubscriptionsChange(newProviders) {
  cancelActiveTurn();
  profile = await memory.setProfile({ ...profile, providers: newProviders, onboardingComplete: true });
  subscriptions = new Set(profile.providers);
  resolvedQueueCards = [];
  sidebar.renderSubscriptions(profile.providers);
  await refreshCatalogMeta();
  chat.populateFacets(catalogMeta, subscribedOrder());
  await renderQueue();
  await seedQueueIfEmpty();
}

function exportMeta() {
  return { query: conversation.messages.filter((m) => m.role === "user").at(-1)?.content || "", generatedAt: new Date().toISOString() };
}

function getExportPicks() {
  return resolvedQueueCards;
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
  cancelActiveTurn();
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
    cancelActiveTurn();
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
  resolvedQueueCards = [];
  sidebar.renderSubscriptions(profile.providers);
  await refreshCatalogMeta();
  chat.populateFacets(catalogMeta, subscribedOrder());
  renderConversation();
  await renderQueue();
  await seedQueueIfEmpty();
}

// ---- Onboarding --------------------------------------------------------------

async function onOnboardingComplete(payload) {
  await memory.setYouMd(payload.youmd || "");
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
  const promptsDoc = await fetchJson("./assets/prompts.json");
  prompts = promptsDoc;
  await runtime.initialize();
  const manifest = await runtime.describe({ subscriptions: [], filters: {} });
  applyCatalogMeta(manifest);
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
    readCsvFile,
    onSubscriptionsChange,
    catalogMeta: () => catalogMeta,
    getExportPicks,
    exportMeta,
    onError: showError
  });

  sidebar = createSidebarView(el, {
    providerLabel,
    onNewChat,
    onExportBackup,
    onImportBackup,
    onClearData
  });

  chat = createChatView(el, {
    providerLabel,
    languageLabel,
    onSubmit,
    onStop
  });

  queueView = createQueueView(el, { watchCta });

  onboarding = createOnboardingView(el, {
    providerOrder,
    store,
    readCsvFile,
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
    subscriptions = new Set(profile.providers);

    if (!profile.onboardingComplete) {
      onboarding.show();
    } else {
      await showShell();
    }

  } catch (err) {
    showError(err && err.message ? err.message : String(err));
  }
}

window.addEventListener("pagehide", () => runtime.dispose());

init();
