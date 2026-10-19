import { toMarkdown, toJson, toCsv, toYouMd } from "../exporters.js";
import {
  RECOMMENDED_OPENROUTER_MODELS,
  buildModelSelectOptions,
  fetchPopularOpenRouterModels,
  isOpenRouterBaseUrl
} from "../openrouter-models.js";
import { createModelPicker } from "./model-picker.js";
import {
  downloadText,
  isAbsoluteHttpUrl,
  renderProviderOptions,
  selectedProviders
} from "./dom.js";

export function renderLearnedFacts(container, draft, onChange = null) {
  container.textContent = "";
  const items = Array.isArray(draft?.items) ? draft.items : [];
  if (items.length === 0) {
    const empty = document.createElement("p");
    empty.className = "note";
    empty.textContent = "No learned preferences yet. Preferences appear here as you chat.";
    container.appendChild(empty);
    return;
  }
  function notify() {
    if (typeof onChange === "function") onChange(draft);
  }
  for (const [index, item] of items.entries()) {
    const row = document.createElement("div");
    row.className = "learned-fact";
    row.setAttribute("role", "listitem");

    const body = document.createElement("div");
    body.className = "learned-fact-body";

    const main = document.createElement("div");
    main.className = "learned-fact-main";

    const polarity = document.createElement("span");
    const isAvoid = String(item.polarity || "like").toLowerCase() === "avoid";
    polarity.className = "learned-fact-badge " + (isAvoid ? "is-avoid" : "is-like");
    polarity.textContent = isAvoid ? "Avoid" : "Like";

    const kind = document.createElement("span");
    kind.className = "learned-fact-kind";
    kind.textContent = item.kind || "genre";

    const value = document.createElement("strong");
    value.className = "learned-fact-value";
    value.textContent = item.value || "";

    main.append(polarity, kind, value);
    body.appendChild(main);

    if (item.subjectTitle || item.reason) {
      const anchor = document.createElement("div");
      anchor.className = "learned-fact-anchor";
      const parts = [];
      if (item.subjectTitle) parts.push(item.subjectTitle);
      if (item.reason) parts.push(item.reason);
      anchor.textContent = parts.join(" — ");
      body.appendChild(anchor);
    }

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "learned-fact-remove";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", "Remove " + (item.value || "preference"));
    remove.addEventListener("click", () => {
      draft.items.splice(index, 1);
      if (Number.isInteger(draft.revision)) draft.revision += 1;
      else draft.revision = 1;
      renderLearnedFacts(container, draft, onChange);
      notify();
    });

    row.append(body, remove);
    container.appendChild(row);
  }
}

/**
 * Secondary UI: settings (subscriptions + LLM key + local-data backups),
 * profile & context (You.md and imported-history counts), and the hidden developer
 * console. Kept out of the primary chat + picks view so they don't compete for
 * attention, and so the sidebar is not a stack of dividers.
 */
export function createDialogs(el, deps) {
  let parsedHistoryDraft; // undefined = no pending change this dialog session
  let savedHistorySummary = "No history imported.";
  let learnedDraft = null;
  let modelPickerController = null;
  let modelPickerRefreshTimer = null;
  let modelPickerCache = null;
  const modelPicker = createModelPicker(el);
  const defaultModelPickerNote = el.llmModelNote.textContent;

  function feedback(node, message = "") {
    node.textContent = message;
    node.hidden = message === "";
  }

  function cancelModelPickerFetch() {
    if (!modelPickerController) return;
    modelPickerController.abort();
    modelPickerController = null;
  }

  function cancelModelPickerRefresh() {
    window.clearTimeout(modelPickerRefreshTimer);
    modelPickerRefreshTimer = null;
    cancelModelPickerFetch();
  }

  function setModelPickerMode(baseUrl) {
    const openRouter = isOpenRouterBaseUrl(baseUrl);
    el.llmModelOpenrouterField.hidden = !openRouter;
    el.llmModelCompatField.hidden = openRouter;
    if (!openRouter) modelPicker.close();
  }

  function readModelSetting() {
    if (!el.llmModelOpenrouterField.hidden) return modelPicker.getValue();
    return el.llmModel.value.trim();
  }

  function renderModelPicker(savedModel, { popular = [], catalogById = null } = {}) {
    const groups = buildModelSelectOptions(RECOMMENDED_OPENROUTER_MODELS, popular, { catalogById });
    modelPicker.setGroups(groups, { selectedModel: savedModel });
  }

  async function refreshModelPicker({ baseUrl, savedModel }) {
    cancelModelPickerFetch();
    setModelPickerMode(baseUrl);
    if (!isOpenRouterBaseUrl(baseUrl)) {
      el.llmModel.value = savedModel || "";
      return;
    }

    renderModelPicker(savedModel);
    el.llmModelNote.textContent = defaultModelPickerNote;

    if (modelPickerCache) {
      renderModelPicker(savedModel, modelPickerCache);
      return;
    }

    const controller = new AbortController();
    modelPickerController = controller;
    const { popular, catalogById } = await fetchPopularOpenRouterModels({
      baseUrl,
      limit: 20,
      signal: controller.signal
    });
    if (controller.signal.aborted || modelPickerController !== controller) return;
    modelPickerController = null;
    if (popular.length > 0) modelPickerCache = { popular, catalogById };
    renderModelPicker(savedModel, { popular, catalogById });
    if (popular.length === 0) {
      el.llmModelNote.textContent = "Showing recommended models. Could not refresh OpenRouter prices.";
    }
  }

  // ---- Settings: subscriptions + LLM key/model/baseUrl ----

  async function openSettings() {
    try {
      const profile = await deps.getProfile();
      renderProviderOptions(
        el.settingsProviderList,
        deps.providerOrder(),
        profile.providers,
        profile.region || "IN"
      );
      const llm = deps.store.getLlm();
      el.llmBaseUrl.value = llm.baseUrl || "";
      el.llmApiKey.value = llm.apiKey || "";
      setModelPickerMode(llm.baseUrl);
      renderModelPicker(llm.model || "");
      el.llmWebSearch.checked = llm.webSearch === true;
      if (el.regionSelect) el.regionSelect.value = profile.region || "IN";
      el.llmWebSearch.disabled = !isOpenRouterBaseUrl(el.llmBaseUrl.value);
      if (el.llmWebSearch.disabled) el.llmWebSearch.checked = false;
      feedback(el.settingsFeedback);
      el.settingsDialog.showModal();
      const firstProvider = el.settingsProviderList.querySelector("input[type='checkbox']");
      if (firstProvider) firstProvider.focus();
      void refreshModelPicker({ baseUrl: llm.baseUrl, savedModel: llm.model || "" });
    } catch (err) {
      deps.onError(err && err.message ? err.message : "Could not open settings.");
    }
  }

  function wireSettings() {
    el.settingsBtn.addEventListener("click", () => {
      void openSettings();
    });

    if (el.regionSelect) {
      el.regionSelect.addEventListener("change", () => {
        renderProviderOptions(
          el.settingsProviderList,
          deps.providerOrder(),
          selectedProviders(el.settingsProviderList),
          el.regionSelect.value || "IN"
        );
      });
    }

    el.settingsSave.addEventListener("click", async () => {
      feedback(el.settingsFeedback);
      const providers = selectedProviders(el.settingsProviderList);
      if (providers.length === 0) {
        feedback(el.settingsFeedback, "Select at least one subscription before saving.");
        return;
      }
      const llm = {
        baseUrl: el.llmBaseUrl.value.trim(),
        apiKey: el.llmApiKey.value.trim(),
        model: readModelSetting(),
        webSearch: isOpenRouterBaseUrl(el.llmBaseUrl.value) && el.llmWebSearch.checked
      };
      if (llm.apiKey && !llm.model) {
        feedback(el.settingsFeedback, "Choose a model or enter a custom model ID before saving.");
        if (isOpenRouterBaseUrl(llm.baseUrl) && modelPicker.isCustomMode()) el.llmModelCustom.focus();
        else if (isOpenRouterBaseUrl(llm.baseUrl)) el.llmModelTrigger.focus();
        else el.llmModel.focus();
        return;
      }
      if (llm.apiKey && !isAbsoluteHttpUrl(llm.baseUrl)) {
        feedback(el.settingsFeedback, "Enter an absolute HTTP(S) model base URL before saving the API key.");
        el.llmBaseUrl.focus();
        return;
      }
      if (!deps.store.setLlm(llm)) {
        feedback(el.settingsFeedback, "Could not save the model settings in this browser.");
        return;
      }
      el.settingsSave.disabled = true;
      try {
        await deps.onSubscriptionsChange(providers, { region: el.regionSelect ? el.regionSelect.value : "IN" });
        el.settingsDialog.close();
      } catch (err) {
        feedback(el.settingsFeedback, err && err.message ? err.message : "Could not save settings.");
      } finally {
        el.settingsSave.disabled = false;
      }
    });

    el.settingsClose.addEventListener("click", () => {
      el.settingsDialog.close();
    });
    el.settingsDialog.addEventListener("close", () => {
      cancelModelPickerRefresh();
      modelPicker.close();
    });
    el.llmBaseUrl.addEventListener("input", () => {
      const enabled = isOpenRouterBaseUrl(el.llmBaseUrl.value);
      el.llmWebSearch.disabled = !enabled;
      if (!enabled) el.llmWebSearch.checked = false;
      const baseUrl = el.llmBaseUrl.value;
      const savedModel = readModelSetting();
      cancelModelPickerRefresh();
      setModelPickerMode(baseUrl);
      if (!enabled) {
        el.llmModel.value = savedModel;
        return;
      }
      modelPickerRefreshTimer = window.setTimeout(() => {
        modelPickerRefreshTimer = null;
        void refreshModelPicker({ baseUrl, savedModel });
      }, 300);
    });
  }

  // ---- Settings: local data (backup export, clear) ----

  function setBusy(busy) {
    el.clearDataBtn.disabled = busy;
    if (el.resetKeepKeyBtn) el.resetKeepKeyBtn.disabled = busy;
  }

  function wireLocalData() {
    el.exportBackupBtn.addEventListener("click", () => deps.onExportBackup());
    el.clearDataBtn.addEventListener("click", () => deps.onClearData());
    el.resetKeepKeyBtn?.addEventListener("click", () => deps.onResetKeepKey?.());
  }

  // ---- Profile & context: You.md plus imported-history counts ----

  function wireContext() {
    function renderContextFacts() {
      renderLearnedFacts(el.learnedFacts, learnedDraft);
    }

    el.contextBtn.addEventListener("click", async () => {
      try {
        const [youmd, history, profile, learned] = await Promise.all([
          deps.getYouMd(), deps.getHistory(), deps.getProfile(), deps.getLearned()
        ]);
        el.youmdInput.value = youmd;
        savedHistorySummary = history ? deps.summarizeHistory(history) : "No history imported.";
        el.historySummary.textContent = savedHistorySummary;
        el.memoryEnabled.checked = profile.memoryEnabled !== false;
        learnedDraft = JSON.parse(JSON.stringify(learned));
        renderContextFacts();
        feedback(el.contextFeedback);
        parsedHistoryDraft = undefined;
        el.contextDialog.showModal();
        deps.onSyncEnrich?.();
      } catch (err) {
        deps.onError(err && err.message ? err.message : "Could not open profile and context.");
      }
    });

    el.contextEnrichBtn?.addEventListener("click", () => deps.onEnrich?.());

    el.historyRemove.addEventListener("click", () => {
      parsedHistoryDraft = null;
      el.historySummary.textContent = "No history imported.";
      feedback(el.contextFeedback);
    });

    el.learnedClear.addEventListener("click", () => {
      if (!learnedDraft) return;
      learnedDraft.items = [];
      learnedDraft.revision = (Number.isInteger(learnedDraft.revision) ? learnedDraft.revision : 0) + 1;
      renderContextFacts();
    });

    el.contextSave.addEventListener("click", async () => {
      feedback(el.contextFeedback);
      el.contextSave.disabled = true;
      try {
        const profile = await deps.getProfile();
        const nextProfile = { ...profile, memoryEnabled: el.memoryEnabled.checked };
        await deps.saveContextMemory({
          youmd: el.youmdInput.value,
          history: parsedHistoryDraft === undefined ? undefined : parsedHistoryDraft,
          profile: nextProfile,
          learned: learnedDraft
        });
        el.contextDialog.close();
      } catch (err) {
        feedback(el.contextFeedback, err && err.message ? err.message : "Could not save profile and context.");
      } finally {
        el.contextSave.disabled = false;
      }
    });

    el.contextClose.addEventListener("click", () => el.contextDialog.close());
    el.contextDialog.addEventListener("close", () => {
      parsedHistoryDraft = undefined;
      learnedDraft = null;
    });
  }

  // ---- Developer console: agent trace, exports, catalog provenance ----

  function traceBody() {
    return el.trace.querySelector("div");
  }

  function clearTrace() {
    traceBody().textContent = "";
    el.trace.open = false;
  }

  function appendTrace(text) {
    const body = traceBody();
    const line = document.createElement("div");
    line.className = "trace-line";
    line.textContent = text;
    body.appendChild(line);
    if (body.childElementCount === 1) el.trace.open = true;
  }

  function fillCatalogDetail(meta) {
    const m = meta || {};
    const parts = [];
    if (m.source) parts.push("Source: " + m.source);
    if (m.region) parts.push("Region: " + String(m.region).toUpperCase());
    const builtAt = String(m.built_at || "").slice(0, 10);
    if (builtAt) parts.push("Built " + builtAt);
    parts.push("Availability comes from a dated catalog snapshot and may have changed.");
    el.catalogDetail.textContent = parts.join(" · ");
  }

  function wireExports() {
    function requirePicks() {
      const picks = deps.getExportPicks();
      if (picks.length === 0) {
        feedback(el.disclosureFeedback, "Nothing to export yet — send a message or check the recommendations first.");
        return null;
      }
      feedback(el.disclosureFeedback);
      return picks;
    }

    el.exportMd.addEventListener("click", () => {
      const picks = requirePicks();
      if (picks) downloadText("watch-picks.md", "text/markdown;charset=utf-8", toMarkdown(picks, deps.exportMeta()));
    });
    el.exportJson.addEventListener("click", () => {
      const picks = requirePicks();
      if (picks) downloadText("watch-picks.json", "application/json;charset=utf-8", toJson(picks, deps.exportMeta()));
    });
    el.exportCsv.addEventListener("click", () => {
      const picks = requirePicks();
      if (picks) downloadText("watch-picks.csv", "text/csv;charset=utf-8", toCsv(picks, deps.exportMeta()));
    });
    el.exportYoumd.addEventListener("click", async () => {
      try {
        downloadText(
          "You.md",
          "text/markdown;charset=utf-8",
          toYouMd(await deps.getYouMd(), await deps.getHistory(), await deps.getLearned())
        );
      } catch (err) {
        feedback(el.disclosureFeedback, err && err.message ? err.message : "Could not export You.md.");
      }
    });
  }

  function openDeveloper() {
    fillCatalogDetail(deps.catalogMeta());
    feedback(el.disclosureFeedback);
    if (!el.disclosureDialog.open) el.disclosureDialog.showModal();
  }

  function wireDeveloper() {
    el.disclosureClose.addEventListener("click", () => el.disclosureDialog.close());
    document.addEventListener("keydown", (event) => {
      if (event.repeat || !event.ctrlKey || !event.altKey || !event.shiftKey ||
        String(event.key).toLowerCase() !== "d") return;
      openDeveloper();
    });
  }

  function syncEnrichState({ visible = false, busy = false, status = "" } = {}) {
    if (el.contextEnrichBtn) {
      el.contextEnrichBtn.hidden = !visible;
      el.contextEnrichBtn.disabled = Boolean(busy);
      el.contextEnrichBtn.textContent = busy ? "Enriching…" : "Enrich taste profile";
    }
    if (el.contextEnrichStatus) {
      const text = typeof status === "string" ? status.trim() : "";
      el.contextEnrichStatus.textContent = text;
      el.contextEnrichStatus.hidden = text === "";
    }
  }

  wireSettings();
  wireLocalData();
  wireContext();
  wireExports();
  wireDeveloper();

  return { appendTrace, clearTrace, openDeveloper, openSettings, setBusy, syncEnrichState };
}
