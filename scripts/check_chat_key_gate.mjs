import assert from "node:assert/strict";
import { bootApp } from "./harness/app.mjs";

const app = await bootApp({ agentFixture: {} });

try {
  assert.equal(app.$("#onboarding-screen").hidden, true);
  assert.equal(app.$("#shell").hidden, false);

  const keyError = app.$("#chat-key-error");
  const keyLink = keyError.querySelector("a");
  assert.equal(keyError.hidden, false);
  assert.equal(keyError.getAttribute("role"), "alert");
  assert.match(keyError.textContent, /Settings/i);
  assert.match(keyError.textContent, /Your model/i);
  assert.match(keyError.textContent, /API key/i);
  assert.equal(keyLink.href, "https://openrouter.ai/keys");
  assert.equal(keyLink.target, "_blank");
  assert.match(keyLink.rel, /noopener/);
  assert.equal(app.$("#send-btn").disabled, true);

  app.$("#query-input").value = "something funny";
  app.$("#query-form").dispatchEvent(new app.window.Event("submit", {
    bubbles: true,
    cancelable: true
  }));
  app.$("#send-btn").click();
  app.$("#query-input").dispatchEvent(new app.window.KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    cancelable: true
  }));
  await app.settle();

  assert.equal(app.$$("#chat-transcript .chat-msg").length, 0);
  assert.equal(app.requested.some((url) => /chat\/completions/.test(url)), false);

  await app.click("#settings-btn");
  app.$("#settings-provider-list input[value=netflix]").click();
  app.$("#llm-api-key").value = "test-key";
  await app.click("#settings-save");

  assert.equal(keyError.hidden, true);
  assert.equal(app.$("#send-btn").disabled, false);

  app.$("#query-input").dispatchEvent(new app.window.KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    cancelable: true
  }));
  await app.settle();

  assert.equal(app.$$("#chat-transcript .chat-msg-user").length, 1);
  assert.match(app.text("#chat-transcript"), /Fixture reply/);
} finally {
  app.restore();
}

console.log("check_chat_key_gate: OK");
