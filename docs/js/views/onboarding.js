import { renderProviderOptions, selectedProviders } from "./dom.js";

/**
 * First-run screen: subscriptions and a required OpenRouter key.
 * Watch history is added later from the chat composer.
 */
export function createOnboardingView(el, deps) {
  const steps = ["subscriptions", "openrouter-key"];
  const panels = Array.from(el.onboardingForm.querySelectorAll("[data-onboarding-step]"));
  let stepIndex = 0;
  let completing = false;

  function currentProviders() {
    return selectedProviders(el.onboardingProviderList);
  }

  function updateControls() {
    el.onboardingBack.hidden = stepIndex === 0;
    el.onboardingBack.disabled = completing;
    el.onboardingNext.disabled = completing;
    el.onboardingNext.textContent = stepIndex === steps.length - 1 ? "Finish" : "Continue";
  }

  function renderStep() {
    for (let index = 0; index < panels.length; index += 1) {
      panels[index].hidden = index !== stepIndex;
    }
    el.onboardingProgress.textContent = `Step ${stepIndex + 1} of ${steps.length}`;
    updateControls();
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
        region: el.onboardingRegionSelect?.value || "IN"
      });
    } catch (err) {
      deps.onError(err && err.message ? err.message : "Could not save onboarding.");
    } finally {
      completing = false;
      updateControls();
    }
  }

  async function advance() {
    if (completing) return;
    if (stepIndex === 0) {
      if (currentProviders().length === 0) {
        deps.onError("Select at least one subscription to continue.");
        return;
      }
      stepIndex += 1;
      renderStep();
      return;
    }
    if (!saveKey()) return;
    await finish();
  }

  function renderProviders() {
    const region = el.onboardingRegionSelect?.value || "IN";
    renderProviderOptions(
      el.onboardingProviderList,
      deps.providerOrder(),
      selectedProviders(el.onboardingProviderList),
      region
    );
  }

  function wireNavigation() {
    el.onboardingBack.addEventListener("click", () => {
      if (completing || stepIndex === 0) return;
      stepIndex -= 1;
      renderStep();
    });
    el.onboardingForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void advance();
    });
    if (el.onboardingRegionSelect) {
      el.onboardingRegionSelect.addEventListener("change", renderProviders);
    }
  }

  function show() {
    stepIndex = 0;
    const llm = deps.store.getLlm();
    el.onboardingLlmApiKey.value = llm.apiKey || "";
    if (el.onboardingRegionSelect) el.onboardingRegionSelect.value = "IN";
    renderProviders();
    el.onboardingScreen.hidden = false;
    renderStep();
  }

  function hide() {
    el.onboardingScreen.hidden = true;
  }

  wireNavigation();

  return { show, hide };
}
