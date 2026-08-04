/**
 * Right-top region: chat transcript plus the persistent composer. Has its own
 * loading/status note independent of the recommendation display below it.
 */
export function createChatView(el, deps) {
  let busy = false;

  function renderMessage(role, content) {
    const wrap = document.createElement("div");
    wrap.className = "chat-msg chat-msg-" + role;
    wrap.setAttribute("role", "article");
    wrap.setAttribute("aria-label", role === "user" ? "You" : "Assistant");
    const bubble = document.createElement("div");
    bubble.className = "chat-bubble";
    bubble.textContent = content;
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

  function facetFilters() {
    const f = {};
    if (el.providerSelect.value) f.provider = el.providerSelect.value;
    if (el.languageSelect.value) f.lang = el.languageSelect.value;
    if (el.genreSelect.value) f.genre = el.genreSelect.value;
    return f;
  }

  function fillSelect(select, values, labelFor, placeholderText) {
    if (select.options.length === 0) {
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = placeholderText;
      select.appendChild(placeholder);
    }
    while (select.options.length > 1) select.remove(1);
    for (const value of values) {
      const option = document.createElement("option");
      option.value = String(value);
      option.textContent = labelFor(value);
      select.appendChild(option);
    }
  }

  function populateFacets(meta, subscribedOrder) {
    const m = meta || {};
    fillSelect(el.providerSelect, subscribedOrder, deps.providerLabel, "All subscriptions");
    const languages = Array.isArray(m.languages) ? m.languages : [];
    fillSelect(el.languageSelect, languages, deps.languageLabel, "All languages");
    const genres = Array.isArray(m.genres) ? m.genres : [];
    fillSelect(el.genreSelect, genres, (name) => String(name), "All genres");
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

  function getMood() {
    return el.moodSelect.value;
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
    facetFilters,
    populateFacets,
    getQuery,
    clearQuery,
    setQuery,
    getMood
  };
}
