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

function createFixture() {
  const form = new FakeElement("form");
  form.steps = [new FakeElement("fieldset"), new FakeElement("fieldset")];
  const el = {
    onboardingScreen: new FakeElement(),
    onboardingForm: form,
    onboardingProgress: new FakeElement(),
    onboardingProviderList: new FakeElement(),
    onboardingLlmApiKey: new FakeElement("input"),
    onboardingRegionSelect: new FakeElement("select"),
    onboardingBack: new FakeElement("button"),
    onboardingNext: new FakeElement("button")
  };
  el.onboardingRegionSelect.value = "IN";
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

{
  const fixture = createFixture();
  fixture.view.show();
  submit(fixture.el);
  assert.equal(fixture.errors.at(-1), "Select at least one subscription to continue.");
  assert.equal(fixture.el.onboardingProgress.textContent, "Step 1 of 2");
  assert.equal(fixture.el.onboardingNext.textContent, "Continue");

  selectNetflix(fixture.el);
  submit(fixture.el);
  assert.equal(fixture.el.onboardingProgress.textContent, "Step 2 of 2");
  assert.equal(fixture.el.onboardingNext.textContent, "Finish");
  submit(fixture.el);
  assert.equal(fixture.errors.at(-1), "Enter your OpenRouter API key to continue.");
  assert.equal(fixture.el.onboardingLlmApiKey.focused, true);

  fixture.el.onboardingLlmApiKey.value = "key-123";
  fixture.el.onboardingRegionSelect.value = "US";
  submit(fixture.el);
  await flush();
  assert.deepEqual(fixture.savedLlm, [{
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: "key-123",
    model: "openai/gpt-4o-mini"
  }]);
  assert.deepEqual(fixture.completed, [{ providers: ["netflix"], region: "US" }]);
  assert.equal("history" in (fixture.completed[0] || {}), false);
  assert.equal("onboardingHistoryFile" in fixture.el, false);
}

console.log("check_onboarding: OK");
