import assert from "node:assert/strict";
import { createOnboardingView } from "../docs/js/views/onboarding.js";

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toLowerCase();
    this.children = [];
    this.listeners = new Map();
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.files = [];
    this.checked = false;
    this.focused = false;
    this._textContent = "";
  }

  get textContent() {
    return this._textContent;
  }

  set textContent(value) {
    this._textContent = String(value);
    this.children = [];
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type, extra = {}) {
    const event = {
      preventDefault() {},
      ...extra
    };
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }

  focus() {
    this.focused = true;
  }

  querySelectorAll(selector) {
    if (selector === "[data-onboarding-step]") return this.steps || [];
    const matches = [];
    const visit = (node) => {
      if (
        node.tagName === "input" &&
        (selector === "input" || (selector === "input:checked" && node.checked))
      ) {
        matches.push(node);
      }
      for (const child of node.children || []) visit(child);
    };
    visit(this);
    return matches;
  }
}

const fakeDocument = {
  createElement(tagName) {
    return new FakeElement(tagName);
  }
};
globalThis.document = fakeDocument;

function flush() {
  return Promise.resolve().then(() => Promise.resolve());
}

function createFixture({ importHistoryFile = async () => ({ schema: 2 }) } = {}) {
  const form = new FakeElement("form");
  form.steps = [new FakeElement("fieldset"), new FakeElement("fieldset"), new FakeElement("fieldset")];
  const el = {
    onboardingScreen: new FakeElement(),
    onboardingForm: form,
    onboardingProgress: new FakeElement(),
    onboardingProviderList: new FakeElement(),
    onboardingLlmApiKey: new FakeElement("input"),
    onboardingHistoryFile: new FakeElement("input"),
    onboardingHistorySummary: new FakeElement(),
    onboardingHistoryStatus: new FakeElement(),
    onboardingHistoryRemove: new FakeElement("button"),
    onboardingBack: new FakeElement("button"),
    onboardingNext: new FakeElement("button")
  };
  const errors = [];
  const savedLlm = [];
  const completed = [];
  const deps = {
    providerOrder: () => ["netflix", "prime"],
    store: {
      getLlm: () => ({ apiKey: "" }),
      setLlm: (value) => {
        savedLlm.push(value);
        return true;
      }
    },
    DEFAULT_LLM: {
      baseUrl: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4o-mini"
    },
    importHistoryFile,
    onComplete: async (payload) => {
      completed.push(payload);
    },
    onError: (message) => errors.push(message)
  };
  return { el, deps, errors, savedLlm, completed, view: createOnboardingView(el, deps) };
}

function selectNetflix(el) {
  const [input] = el.onboardingProviderList.querySelectorAll("input");
  input.checked = true;
}

function submit(el) {
  el.onboardingForm.emit("submit");
}

function advanceToHistory(fixture) {
  fixture.view.show();
  selectNetflix(fixture.el);
  submit(fixture.el);
  fixture.el.onboardingLlmApiKey.value = "key-123";
  submit(fixture.el);
}

{
  const fixture = createFixture();
  fixture.view.show();
  submit(fixture.el);
  assert.equal(fixture.errors.at(-1), "Select at least one subscription to continue.");
  assert.equal(fixture.el.onboardingProgress.textContent, "Step 1 of 3");

  selectNetflix(fixture.el);
  submit(fixture.el);
  assert.equal(fixture.el.onboardingProgress.textContent, "Step 2 of 3");
  submit(fixture.el);
  assert.equal(fixture.errors.at(-1), "Enter your OpenRouter API key to continue.");
  assert.equal(fixture.el.onboardingLlmApiKey.focused, true);

  fixture.el.onboardingLlmApiKey.value = "key-123";
  submit(fixture.el);
  assert.deepEqual(fixture.savedLlm, [{
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: "key-123",
    model: "openai/gpt-4o-mini"
  }]);
  assert.equal(fixture.el.onboardingProgress.textContent, "Step 3 of 3");
  assert.equal(fixture.el.onboardingNext.textContent, "Continue without history");
}

{
  let pendingSignal;
  const fixture = createFixture({
    importHistoryFile: (_file, { signal, onStatus }) => {
      pendingSignal = signal;
      onStatus("Inspecting export…");
      return new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    }
  });
  advanceToHistory(fixture);
  fixture.el.onboardingHistoryFile.files = [{ name: "history.csv" }];
  fixture.el.onboardingHistoryFile.emit("change");
  assert.equal(fixture.el.onboardingNext.disabled, true);
  assert.equal(fixture.el.onboardingBack.disabled, true);
  assert.equal(fixture.el.onboardingHistoryStatus.textContent, "Inspecting export…");
  fixture.view.hide();
  assert.equal(pendingSignal.aborted, true);
  await flush();
}

{
  const fixture = createFixture({
    importHistoryFile: async () => {
      throw new Error("Unsupported export");
    }
  });
  advanceToHistory(fixture);
  fixture.el.onboardingHistoryFile.files = [{ name: "history.zip" }];
  fixture.el.onboardingHistoryFile.emit("change");
  await flush();
  assert.equal(fixture.el.onboardingHistoryStatus.textContent, "Unsupported export");
  assert.equal(fixture.el.onboardingHistoryRemove.hidden, false);
  assert.equal(fixture.el.onboardingNext.textContent, "Continue without history");
  fixture.el.onboardingHistoryRemove.emit("click");
  assert.equal(fixture.el.onboardingHistoryFile.value, "");
  assert.equal(fixture.el.onboardingHistoryStatus.textContent, "");
  submit(fixture.el);
  await flush();
  assert.deepEqual(fixture.completed, [{ providers: ["netflix"], history: null }]);
}

{
  const history = { schema: 2, movies: [{ name: "Film" }] };
  const fixture = createFixture({
    importHistoryFile: async (_file, { onStatus }) => {
      onStatus("Reading sample…");
      return history;
    }
  });
  advanceToHistory(fixture);
  fixture.el.onboardingHistoryFile.files = [{ name: "history.json" }];
  fixture.el.onboardingHistoryFile.emit("change");
  await flush();
  assert.equal(fixture.el.onboardingHistorySummary.textContent, "Watch history imported.");
  assert.equal(fixture.el.onboardingNext.textContent, "Finish");
  submit(fixture.el);
  await flush();
  assert.deepEqual(fixture.completed, [{ providers: ["netflix"], history }]);
  assert.deepEqual(Object.keys(fixture.completed[0]).sort(), ["history", "providers"]);
  assert.equal("onboardingYoumdInput" in fixture.el, false);
}

console.log("check_onboarding: OK");
