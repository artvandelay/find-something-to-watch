/**
 * Right-top region: chat transcript plus the persistent composer. Has its own
 * loading/status note independent of the recommendation display below it.
 */
import { parseMarkdown, renderMarkdown } from "./markdown.js";

export function createChatView(el, deps) {
  let busy = false;

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
  }

  function scrollToEnd() {
    el.chatTranscript.scrollTop = el.chatTranscript.scrollHeight;
  }

  function renderConversation(messages) {
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
    renderMessage(role, content);
    scrollToEnd();
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
    el.sendBtn.disabled = busy;
    el.queryInput.disabled = busy;
    el.stopBtn.hidden = !busy;
    el.sendBtn.hidden = busy;
    if (restoreFocus) el.queryInput.focus();
  }

  function setSendReady(ready) {
    el.sendBtn.disabled = busy || !ready;
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
  el.stopBtn.addEventListener("click", () => deps.onStop());

  return {
    renderConversation,
    appendMessage,
    setNote,
    setBusy,
    setSendReady,
    getQuery,
    clearQuery,
    setQuery
  };
}
