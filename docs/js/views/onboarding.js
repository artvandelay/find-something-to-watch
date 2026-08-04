import { renderProviderOptions, selectedProviders } from "./dom.js";

/**
 * First-run screen: subscriptions, required OpenRouter key, and optional
 * provider-neutral watch-history import.
 */
export function createOnboardingView(el, deps) {
  const steps = ["subscriptions", "openrouter-key", "watch-history"];
  const panels = Array.from(el.onboardingForm.querySelectorAll("[data-onboarding-step]"));
  let stepIndex = 0;
  let parsedHistory = null;
  let importController = null;
  let importFailed = false;
  let completing = false;

  function currentProviders() {
    return selectedProviders(el.onboardingProviderList);
  }

  function setStatus(message) {
    el.onboardingHistoryStatus.textContent = message || "";
  }

  function isImporting() {
    return importController !== null;
  }

  function updateControls() {
    const busy = isImporting() || completing;
    el.onboardingBack.hidden = stepIndex === 0;
    el.onboardingBack.disabled = busy;
    el.onboardingNext.disabled = busy;
    el.onboardingHistoryFile.disabled = busy;
    el.onboardingHistoryRemove.disabled = busy;
    el.onboardingHistoryRemove.hidden = !isImporting() && !importFailed && !parsedHistory;

    if (stepIndex < 2) {
      el.onboardingNext.textContent = "Continue";
    } else if (parsedHistory) {
      el.onboardingNext.textContent = "Finish";
    } else {
      el.onboardingNext.textContent = "Continue without history";
    }
  }

  function renderStep() {
    for (let index = 0; index < panels.length; index += 1) {
      panels[index].hidden = index !== stepIndex;
    }
    el.onboardingProgress.textContent = `Step ${stepIndex + 1} of ${steps.length}`;
    updateControls();
  }

  function abortImport() {
    if (!importController) return;
    importController.abort();
    importController = null;
  }

  function clearHistoryFile() {
    abortImport();
    parsedHistory = null;
    importFailed = false;
    el.onboardingHistoryFile.value = "";
    el.onboardingHistorySummary.textContent = "";
    setStatus("");
    updateControls();
  }

  async function importHistoryFile(file) {
    abortImport();
    parsedHistory = null;
    importFailed = false;
    el.onboardingHistorySummary.textContent = "";
    setStatus("Importing watch history…");
    const controller = new AbortController();
    importController = controller;
    updateControls();

    try {
      const history = await deps.importHistoryFile(file, {
        signal: controller.signal,
        onStatus: setStatus
      });
      if (controller.signal.aborted || importController !== controller) return;
      parsedHistory = history;
      el.onboardingHistorySummary.textContent = "Watch history imported.";
      setStatus("");
    } catch (err) {
      if (controller.signal.aborted || importController !== controller) return;
      importFailed = true;
      setStatus(err && err.message ? err.message : "Could not import this watch-history file.");
    } finally {
      if (importController === controller) {
        importController = null;
        updateControls();
      }
    }
  }

  function saveKey() {
    const apiKey = el.onboardingLlmApiKey.value.trim();
    if (!apiKey) {
      deps.onError("Enter your OpenRouter API key to continue.");
      el.onboardingLlmApiKey.focus();
      return false;
    }
    if (!deps.store.setLlm({
      baseUrl: deps.DEFAULT_LLM.baseUrl,
      apiKey,
      model: deps.DEFAULT_LLM.model
    })) {
      deps.onError("Could not save the model settings in this browser.");
      return false;
    }
    return true;
  }

  async function finish() {
    completing = true;
    updateControls();
    try {
      await deps.onComplete({
        providers: currentProviders(),
        history: parsedHistory
      });
    } catch (err) {
      deps.onError(err && err.message ? err.message : "Could not save onboarding.");
    } finally {
      completing = false;
      updateControls();
    }
  }

  async function advance() {
    if (isImporting() || completing) return;
    if (stepIndex === 0) {
      if (currentProviders().length === 0) {
        deps.onError("Select at least one subscription to continue.");
        return;
      }
      stepIndex += 1;
      renderStep();
      return;
    }
    if (stepIndex === 1) {
      if (!saveKey()) return;
      stepIndex += 1;
      renderStep();
      return;
    }
    await finish();
  }

  function wireHistoryFile() {
    el.onboardingHistoryFile.addEventListener("change", () => {
      const file = el.onboardingHistoryFile.files && el.onboardingHistoryFile.files[0];
      if (!file) return;
      void importHistoryFile(file);
    });
    el.onboardingHistoryRemove.addEventListener("click", clearHistoryFile);
  }

  function wireNavigation() {
    el.onboardingBack.addEventListener("click", () => {
      if (isImporting() || completing || stepIndex === 0) return;
      stepIndex -= 1;
      renderStep();
    });
    el.onboardingForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void advance();
    });
  }

  function show() {
    abortImport();
    stepIndex = 0;
    parsedHistory = null;
    importFailed = false;
    renderProviderOptions(el.onboardingProviderList, deps.providerOrder());
    const llm = deps.store.getLlm();
    el.onboardingLlmApiKey.value = llm.apiKey || "";
    el.onboardingHistoryFile.value = "";
    el.onboardingHistorySummary.textContent = "";
    setStatus("");
    el.onboardingScreen.hidden = false;
    renderStep();
  }

  function hide() {
    abortImport();
    el.onboardingScreen.hidden = true;
  }

  wireHistoryFile();
  wireNavigation();

  return { show, hide };
}
