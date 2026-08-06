/**
 * Right-top region: chat transcript plus the persistent composer. Has its own
 * loading/status note independent of the recommendation display below it.
 */
import { parseMarkdown, renderMarkdown } from "./markdown.js";

export function createChatView(el, deps) {
  let busy = false;
  let keyAvailable = false;
  let sendReady = false;
  let activeTurn = null;

  function renderMessage(role, content) {
    const wrap = document.createElement("div");
    wrap.className = "chat-msg chat-msg-" + role;
    wrap.setAttribute("role", "article");
    wrap.setAttribute("aria-label", role === "user" ? "You" : "Assistant");
    const bubble = document.createElement("div");
    bubble.className = "chat-bubble";
    if (role === "assistant") {
      bubble.appendChild(renderMarkdown(parseMarkdown(content), document));
    } else {
      bubble.appendChild(document.createTextNode(String(content ?? "")));
    }
    wrap.appendChild(bubble);
    el.chatTranscript.appendChild(wrap);
    return wrap;
  }

  function scrollToEnd() {
    el.chatTranscript.scrollTop = el.chatTranscript.scrollHeight;
  }

  function renderConversation(messages) {
    activeTurn = null;
    el.chatTranscript.textContent = "";
    if (messages.length === 0) {
      const empty = document.createElement("p");
      empty.className = "note chat-empty";
      empty.textContent = "Ask for something to watch — your subscriptions and taste shape the picks.";
      el.chatTranscript.appendChild(empty);
      return;
    }
    for (const m of messages) renderMessage(m.role, m.content);
    scrollToEnd();
  }

  function appendMessage(role, content) {
    if (el.chatTranscript.querySelector(".chat-empty")) el.chatTranscript.textContent = "";
    const message = renderMessage(role, content);
    scrollToEnd();
    return message;
  }

  function createActivity() {
    const wrap = document.createElement("section");
    wrap.className = "chat-turn-activity";
    wrap.setAttribute("aria-label", "Assistant activity");

    const status = document.createElement("p");
    status.className = "chat-turn-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    wrap.appendChild(status);

    const elapsed = document.createElement("span");
    elapsed.className = "chat-turn-elapsed";
    elapsed.setAttribute("aria-hidden", "true");
    elapsed.hidden = true;
    wrap.appendChild(elapsed);

    const stop = document.createElement("button");
    stop.type = "button";
    stop.className = "chat-turn-stop";
    stop.textContent = "Stop";
    stop.addEventListener("click", () => deps.onStop());
    wrap.appendChild(stop);

    const response = document.createElement("div");
    response.className = "chat-turn-response";
    response.hidden = true;
    wrap.appendChild(response);

    const error = document.createElement("p");
    error.className = "chat-turn-error";
    error.setAttribute("role", "alert");
    error.hidden = true;
    wrap.appendChild(error);

    const metrics = document.createElement("p");
    metrics.className = "chat-turn-metrics";
    metrics.hidden = true;
    wrap.appendChild(metrics);

    return { wrap, status, elapsed, stop, response, error, metrics, partial: "", toolCounts: [] };
  }

  function startTurn() {
    if (el.chatTranscript.querySelector(".chat-empty")) el.chatTranscript.textContent = "";
    activeTurn = createActivity();
    el.chatTranscript.appendChild(activeTurn.wrap);
    setTurnStatus("PLANNING");
    scrollToEnd();
  }

  function setTurnStatus(text) {
    if (!activeTurn) return;
    activeTurn.status.textContent = String(text || "").trim();
  }

  function setTurnElapsed(milliseconds, { slow = false } = {}) {
    if (!activeTurn || !Number.isFinite(milliseconds) || milliseconds < 1000) return;
    activeTurn.elapsed.hidden = false;
    activeTurn.elapsed.textContent = (milliseconds / 1000).toFixed(1) + "s";
    activeTurn.wrap.classList.toggle("is-slow", Boolean(slow));
  }

  function addToolResult(count) {
    if (!activeTurn || !Number.isFinite(count) || count < 0) return;
    activeTurn.toolCounts.push(count);
  }

  function appendDelta(text) {
    if (!activeTurn || typeof text !== "string" || text === "") return;
    activeTurn.partial += text;
    activeTurn.response.hidden = false;
    activeTurn.response.textContent = activeTurn.partial;
    scrollToEnd();
  }

  function formatMetrics({ timing, usage, billing } = {}) {
    const items = [];
    if (Number.isFinite(timing?.totalMs)) items.push((timing.totalMs / 1000).toFixed(1) + "s");
    if (Number.isFinite(usage?.totalTokens)) items.push(usage.totalTokens + " tokens");
    if (billing?.basis === "provider_reported" && billing.complete === true &&
      Number.isFinite(billing.amountUsd)) {
      items.push("$" + billing.amountUsd.toFixed(4) + " reported");
    } else {
      items.push("Cost unavailable");
    }
    return items.join(" · ");
  }

  function completeTurn({ reply, timing, usage, billing, catalogCount = null } = {}) {
    if (!activeTurn) return;
    activeTurn.response.hidden = false;
    activeTurn.response.textContent = "";
    activeTurn.response.appendChild(renderMarkdown(parseMarkdown(reply || ""), document));
    activeTurn.stop.hidden = true;
    activeTurn.elapsed.hidden = true;
    const matches = activeTurn.toolCounts.reduce((total, count) => total + count, 0);
    const summary = [];
    if (Number.isFinite(catalogCount) && catalogCount >= 0) summary.push(catalogCount.toLocaleString("en-IN") + " titles");
    if (matches > 0) summary.push(matches + " matches");
    if (Number.isFinite(timing?.totalMs)) summary.push((timing.totalMs / 1000).toFixed(1) + "s");
    activeTurn.status.textContent = summary.join(" · ") || "Complete";
    activeTurn.metrics.textContent = formatMetrics({ timing, usage, billing });
    activeTurn.metrics.hidden = false;
    activeTurn.wrap.classList.add("is-complete");
    scrollToEnd();
    activeTurn = null;
  }

  function failTurn({ message, partialReply = "", timing } = {}) {
    if (!activeTurn) return;
    const partial = String(partialReply || activeTurn.partial || "");
    if (partial) {
      activeTurn.response.hidden = false;
      activeTurn.response.textContent = partial;
    }
    activeTurn.stop.hidden = true;
    activeTurn.elapsed.hidden = true;
    activeTurn.status.textContent = "Stopped";
    activeTurn.error.textContent = String(message || "The turn did not complete.");
    activeTurn.error.hidden = false;
    if (Number.isFinite(timing?.totalMs)) {
      activeTurn.metrics.textContent = (timing.totalMs / 1000).toFixed(1) + "s";
      activeTurn.metrics.hidden = false;
    }
    activeTurn.wrap.classList.add("is-error");
    scrollToEnd();
    activeTurn = null;
  }

  function setNote(text) {
    const value = typeof text === "string" ? text.trim() : "";
    el.chatNote.textContent = value;
    el.chatNote.hidden = value === "";
  }

  function setBusy(nextBusy) {
    const restoreFocus = !nextBusy && document.activeElement === el.stopBtn;
    busy = nextBusy;
    el.chatRegion.setAttribute("aria-busy", busy ? "true" : "false");
    el.sendBtn.disabled = busy || !keyAvailable || !sendReady;
    el.queryInput.disabled = busy;
    el.stopBtn.hidden = !busy;
    el.sendBtn.hidden = busy;
    if (restoreFocus) el.queryInput.focus();
  }

  function setSendReady(ready) {
    sendReady = Boolean(ready);
    el.sendBtn.disabled = busy || !keyAvailable || !sendReady;
  }

  function setKeyAvailable(available) {
    keyAvailable = Boolean(available);
    el.chatKeyError.hidden = keyAvailable;
    el.queryForm.setAttribute("aria-disabled", keyAvailable ? "false" : "true");
    el.sendBtn.disabled = busy || !keyAvailable || !sendReady;
  }

  function getQuery() {
    return String(el.queryInput.value || "").trim();
  }

  function clearQuery() {
    el.queryInput.value = "";
  }

  function setQuery(value) {
    el.queryInput.value = String(value || "");
  }

  el.queryForm.addEventListener("submit", (event) => {
    event.preventDefault();
    deps.onSubmit();
  });
  el.queryInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    if (!el.sendBtn.disabled) el.queryForm.requestSubmit();
  });
  el.stopBtn.addEventListener("click", () => deps.onStop());

  return {
    renderConversation,
    appendMessage,
    startTurn,
    setTurnStatus,
    setTurnElapsed,
    addToolResult,
    appendDelta,
    completeTurn,
    failTurn,
    setNote,
    setBusy,
    setSendReady,
    setKeyAvailable,
    getQuery,
    clearQuery,
    setQuery
  };
}
