import { isAbsoluteHttpUrl, renderProviderOptions, selectedProviders } from "./dom.js";

function isOpenRouterUrl(value) {
  try {
    return new URL(String(value || "")).hostname === "openrouter.ai";
  } catch {
    return false;
  }
}

/**
 * First-run screen: subscriptions, BYO LLM key, optional You.md/CSV, and the
 * privacy/caveats copy.
 */
export function createOnboardingView(el, deps) {
  let parsedHistory;
  const webSearch = el.onboardingWebSearch || document.getElementById("onboarding-web-search");

  function updateWebSearchAvailability() {
    const available = isOpenRouterUrl(el.onboardingLlmBaseUrl.value.trim());
    webSearch.disabled = !available;
    if (!available) webSearch.checked = false;
  }

  function wireWebSearch() {
    el.onboardingLlmBaseUrl.addEventListener("input", updateWebSearchAvailability);
  }

  function wireHistoryFile() {
    el.onboardingHistoryFile.addEventListener("change", () => {
      const file = el.onboardingHistoryFile.files && el.onboardingHistoryFile.files[0];
      if (!file) return;
      deps.readCsvFile(file, (parsed, summaryText) => {
        if (parsed) parsedHistory = parsed;
        el.onboardingHistorySummary.textContent = summaryText;
      });
    });
  }

  function wireSubmit() {
    el.onboardingForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const providers = selectedProviders(el.onboardingProviderList);
      if (providers.length === 0) {
        deps.onError("Select at least one subscription to continue.");
        return;
      }
      const llm = {
        baseUrl: el.onboardingLlmBaseUrl.value.trim(),
        apiKey: el.onboardingLlmApiKey.value.trim(),
        model: el.onboardingLlmModel.value.trim(),
        webSearch: isOpenRouterUrl(el.onboardingLlmBaseUrl.value.trim()) && webSearch.checked === true
      };
      if (llm.apiKey && !isAbsoluteHttpUrl(llm.baseUrl)) {
        deps.onError("Enter an absolute HTTP(S) model base URL before saving the API key.");
        el.onboardingLlmBaseUrl.focus();
        return;
      }
      if (!deps.store.setLlm(llm)) {
        deps.onError("Could not save the model settings in this browser.");
        return;
      }
      el.onboardingContinue.disabled = true;
      try {
        await deps.onComplete({
          providers,
          youmd: el.onboardingYoumdInput.value,
          history: parsedHistory ?? null
        });
      } catch (err) {
        deps.onError(err && err.message ? err.message : "Could not save onboarding.");
      } finally {
        el.onboardingContinue.disabled = false;
      }
    });
  }

  function show() {
    renderProviderOptions(el.onboardingProviderList, deps.providerOrder());
    const llm = deps.store.getLlm();
    el.onboardingLlmBaseUrl.value = llm.baseUrl || "";
    el.onboardingLlmApiKey.value = llm.apiKey || "";
    el.onboardingLlmModel.value = llm.model || "";
    webSearch.checked = llm.webSearch === true;
    updateWebSearchAvailability();
    el.onboardingYoumdInput.value = "";
    el.onboardingHistorySummary.textContent = "";
    parsedHistory = undefined;
    el.onboardingScreen.hidden = false;
  }

  function hide() {
    el.onboardingScreen.hidden = true;
  }

  wireHistoryFile();
  wireWebSearch();
  wireSubmit();

  return { show, hide };
}
