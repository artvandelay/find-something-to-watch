import { toMarkdown, toJson, toCsv, toYouMd } from "../exporters.js";
import {
  downloadText,
  isAbsoluteHttpUrl,
  renderProviderOptions,
  selectedProviders
} from "./dom.js";

function isOpenRouterUrl(value) {
  try {
    return new URL(String(value || "")).hostname === "openrouter.ai";
  } catch {
    return false;
  }
}

/**
 * Secondary UI: settings (subscriptions + LLM key), profile & context
 * (You.md + watch-history import), and the hidden developer console.
 * Kept out of the primary chat + recommendation view so they don't compete
 * for attention.
 */
export function createDialogs(el, deps) {
  let parsedHistoryDraft; // undefined = no pending change this dialog session
  let historyImportController = null;
  let savedHistorySummary = "No history imported.";

  function feedback(node, message = "") {
    node.textContent = message;
    node.hidden = message === "";
  }

  function cancelHistoryImport() {
    if (!historyImportController) return;
    historyImportController.abort();
    historyImportController = null;
  }

  // ---- Settings: subscriptions + LLM key/model/baseUrl ----

  function wireSettings() {
    el.settingsBtn.addEventListener("click", async () => {
      try {
        const profile = await deps.getProfile();
        renderProviderOptions(el.settingsProviderList, deps.providerOrder(), profile.providers);
        const llm = deps.store.getLlm();
        el.llmBaseUrl.value = llm.baseUrl || "";
        el.llmApiKey.value = llm.apiKey || "";
        el.llmModel.value = llm.model || "";
        el.llmWebSearch.checked = llm.webSearch === true;
        el.llmWebSearch.disabled = !isOpenRouterUrl(el.llmBaseUrl.value);
        if (el.llmWebSearch.disabled) el.llmWebSearch.checked = false;
        feedback(el.settingsFeedback);
        el.settingsDialog.showModal();
      } catch (err) {
        deps.onError(err && err.message ? err.message : "Could not open settings.");
      }
    });

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
        model: el.llmModel.value.trim(),
        webSearch: isOpenRouterUrl(el.llmBaseUrl.value) && el.llmWebSearch.checked
      };
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
        await deps.onSubscriptionsChange(providers);
        el.settingsDialog.close();
      } catch (err) {
        feedback(el.settingsFeedback, err && err.message ? err.message : "Could not save settings.");
      } finally {
        el.settingsSave.disabled = false;
      }
    });

    el.settingsClose.addEventListener("click", () => el.settingsDialog.close());
    el.llmBaseUrl.addEventListener("input", () => {
      const enabled = isOpenRouterUrl(el.llmBaseUrl.value);
      el.llmWebSearch.disabled = !enabled;
      if (!enabled) el.llmWebSearch.checked = false;
    });
  }

  // ---- Profile & context: You.md + watch-history import ----

  function wireContext() {
    el.contextBtn.addEventListener("click", async () => {
      try {
        cancelHistoryImport();
        el.youmdInput.value = await deps.getYouMd();
        const history = await deps.getHistory();
        savedHistorySummary = history ? deps.summarizeHistory(history) : "No history imported.";
        el.historySummary.textContent = savedHistorySummary;
        feedback(el.contextFeedback);
        parsedHistoryDraft = undefined;
        el.contextDialog.showModal();
      } catch (err) {
        deps.onError(err && err.message ? err.message : "Could not open profile and context.");
      }
    });

    el.historyFile.addEventListener("change", async () => {
      const file = el.historyFile.files && el.historyFile.files[0];
      if (!file) return;

      cancelHistoryImport();
      parsedHistoryDraft = undefined;
      const controller = new AbortController();
      historyImportController = controller;
      feedback(el.contextFeedback, `Importing ${file.name}…`);

      try {
        const parsed = await deps.importHistoryFile(file, {
          signal: controller.signal,
          onStatus: (message) => {
            if (historyImportController === controller && !controller.signal.aborted) {
              feedback(el.contextFeedback, message);
            }
          }
        });
        if (historyImportController !== controller || controller.signal.aborted) return;
        parsedHistoryDraft = parsed;
        el.historySummary.textContent = deps.summarizeHistory(parsed);
        feedback(el.contextFeedback, "History is ready to save.");
      } catch (err) {
        if (historyImportController !== controller || controller.signal.aborted) return;
        el.historySummary.textContent = savedHistorySummary;
        feedback(el.contextFeedback, err && err.message ? err.message : "Could not import watch history. Existing history was not changed.");
      } finally {
        if (historyImportController === controller) historyImportController = null;
      }
    });

    el.historyRemove.addEventListener("click", () => {
      cancelHistoryImport();
      parsedHistoryDraft = null;
      el.historySummary.textContent = "No history imported.";
      feedback(el.contextFeedback);
    });

    el.contextSave.addEventListener("click", async () => {
      feedback(el.contextFeedback);
      el.contextSave.disabled = true;
      try {
        await deps.setYouMd(el.youmdInput.value);
        if (parsedHistoryDraft !== undefined) await deps.setHistory(parsedHistoryDraft);
        el.contextDialog.close();
      } catch (err) {
        feedback(el.contextFeedback, err && err.message ? err.message : "Could not save profile and context.");
      } finally {
        el.contextSave.disabled = false;
      }
    });

    el.contextClose.addEventListener("click", () => el.contextDialog.close());
    el.contextDialog.addEventListener("close", () => {
      cancelHistoryImport();
      parsedHistoryDraft = undefined;
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
    parts.push("Static snapshot — real availability changes constantly.");
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
        downloadText("You.md", "text/markdown;charset=utf-8", toYouMd(await deps.getYouMd(), await deps.getHistory()));
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

  wireSettings();
  wireContext();
  wireExports();
  wireDeveloper();

  return { appendTrace, clearTrace, openDeveloper };
}
