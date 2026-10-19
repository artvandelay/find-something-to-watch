/**
 * Right-top region: chat transcript plus the persistent composer. Has its own
 * loading/status note independent of the recommendation display below it.
 */
import { parseMarkdown, renderMarkdown } from "./markdown.js";

const NEAR_BOTTOM_PX = 96;

const TURN_STEPS = Object.freeze([
  { id: "services", match: /seeing what you can watch/i, label: "Seeing what you can watch" },
  { id: "search", match: /looking for a good fit/i, label: "Looking for a good fit" },
  { id: "compare", match: /narrowing it down/i, label: "Narrowing it down" },
  { id: "write", match: /choosing a few to watch|thinking about that one/i, label: "Choosing a few to watch" }
]);

export function createChatView(el, deps) {
  let busy = false;
  let keyAvailable = false;
  let sendReady = false;
  let activeTurn = null;
  let streamFrame = 0;

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

  function isNearBottom() {
    const node = el.chatTranscript;
    return node.scrollHeight - node.scrollTop - node.clientHeight <= NEAR_BOTTOM_PX;
  }

  function scrollToEnd() {
    el.chatTranscript.scrollTop = el.chatTranscript.scrollHeight;
  }

  function cancelStreamFrame() {
    if (!streamFrame) return;
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(streamFrame);
    streamFrame = 0;
  }

  function flushStreamFrame() {
    streamFrame = 0;
    if (!activeTurn) return;
    activeTurn.response.hidden = false;
    activeTurn.response.textContent = activeTurn.partial;
    if (activeTurn.stickToBottom) scrollToEnd();
  }

  function renderWelcome(welcome) {
    const section = document.createElement("section");
    section.className = "chat-welcome";
    section.setAttribute("aria-label", "Welcome");
    const headline = document.createElement("p");
    headline.className = "chat-welcome-headline";
    headline.textContent = welcome.headline || "";
    section.appendChild(headline);
    if (welcome.sub) {
      const sub = document.createElement("p");
      sub.className = "chat-welcome-sub";
      sub.textContent = welcome.sub;
      section.appendChild(sub);
    }
    const memory = document.createElement("p");
    memory.className = "chat-welcome-memory";
    if (welcome.memoryLine) {
      const text = document.createElement("span");
      text.textContent = welcome.memoryLine;
      memory.appendChild(text);
    }
    const seeAll = document.createElement("button");
    seeAll.type = "button";
    seeAll.className = "chat-welcome-memory-link";
    seeAll.textContent = welcome.memoryLine ? "See all" : "What I remember";
    seeAll.addEventListener("click", () => deps.onOpenMemory?.());
    memory.appendChild(seeAll);
    if (welcome.canEnrich) {
      const enrichBtn = document.createElement("button");
      enrichBtn.type = "button";
      enrichBtn.className = "chat-welcome-memory-link chat-welcome-enrich-link";
      enrichBtn.textContent = "Enrich taste profile";
      enrichBtn.addEventListener("click", () => deps.onEnrich?.());
      memory.appendChild(enrichBtn);
    }
    section.appendChild(memory);
    const chips = document.createElement("div");
    chips.className = "chat-chips";
    chips.setAttribute("role", "group");
    chips.setAttribute("aria-label", "Suggestions");
    for (const chip of Array.isArray(welcome.chips) ? welcome.chips : []) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chat-chip";
      button.textContent = chip.label;
      button.dataset.query = chip.query;
      button.addEventListener("click", () => {
        setQuery(chip.query);
        if (!busy && sendReady) deps.onSubmit();
        else el.queryInput.focus();
      });
      chips.appendChild(button);
    }
    section.appendChild(chips);
    el.chatTranscript.appendChild(section);
  }

  function renderConversation(messages, view = {}) {
    cancelStreamFrame();
    activeTurn = null;
    el.chatTranscript.textContent = "";
    const list = Array.isArray(messages) ? messages : [];
    list.forEach((message, index) => {
      const label = view.dividers?.[index];
      if (label) {
        const divider = document.createElement("div");
        divider.className = "chat-divider";
        divider.setAttribute("role", "separator");
        divider.setAttribute("aria-label", label);
        const span = document.createElement("span");
        span.textContent = label;
        divider.appendChild(span);
        el.chatTranscript.appendChild(divider);
      }
      renderMessage(message.role, message.content);
      if (view.picks?.[index]?.length && typeof deps.renderInlinePicks === "function") {
        const node = deps.renderInlinePicks(view.picks[index]);
        if (node) el.chatTranscript.appendChild(node);
      }
    });
    if (view.welcome) renderWelcome(view.welcome);
    scrollToEnd();
  }

  function clearWelcome() {
    el.chatTranscript.querySelector(".chat-welcome")?.remove();
  }

  function appendMessage(role, content) {
    clearWelcome();
    const message = renderMessage(role, content);
    scrollToEnd();
    return message;
  }

  function appendPicks(recs) {
    const node = deps.renderInlinePicks?.(recs);
    if (!node) return;
    el.chatTranscript.appendChild(node);
    scrollToEnd();
  }

  function createActivity() {
    const wrap = document.createElement("section");
    wrap.className = "chat-turn-activity";
    wrap.setAttribute("aria-label", "Assistant activity");

    const head = document.createElement("div");
    head.className = "chat-turn-head";

    const status = document.createElement("p");
    status.className = "chat-turn-status visually-hidden";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    head.appendChild(status);

    const elapsed = document.createElement("span");
    elapsed.className = "chat-turn-elapsed";
    elapsed.setAttribute("aria-hidden", "true");
    elapsed.hidden = true;
    head.appendChild(elapsed);

    const stop = document.createElement("button");
    stop.type = "button";
    stop.className = "chat-turn-stop";
    stop.textContent = "Stop";
    stop.addEventListener("click", () => deps.onStop());
    head.appendChild(stop);
    wrap.appendChild(head);

    const steps = document.createElement("ol");
    steps.className = "chat-turn-steps";
    steps.setAttribute("aria-hidden", "true");
    const stepNodes = TURN_STEPS.map((step, index) => {
      const item = document.createElement("li");
      item.className = "chat-turn-step" + (index === 0 ? " is-active" : " is-pending");
      item.dataset.step = step.id;
      item.textContent = step.label;
      steps.appendChild(item);
      return item;
    });
    wrap.appendChild(steps);

    const slowNote = document.createElement("p");
    slowNote.className = "chat-turn-slow";
    slowNote.hidden = true;
    wrap.appendChild(slowNote);

    const response = document.createElement("div");
    response.className = "chat-turn-response";
    response.hidden = true;
    wrap.appendChild(response);

    const error = document.createElement("p");
    error.className = "chat-turn-error";
    error.setAttribute("role", "alert");
    error.hidden = true;
    wrap.appendChild(error);

    return {
      wrap,
      status,
      elapsed,
      stop,
      steps,
      stepNodes,
      slowNote,
      response,
      error,
      partial: "",
      toolCounts: [],
      stickToBottom: true,
      stepIndex: 0
    };
  }

  function startTurn() {
    cancelStreamFrame();
    clearWelcome();
    activeTurn = createActivity();
    el.chatTranscript.appendChild(activeTurn.wrap);
    setTurnStatus("Seeing what you can watch");
    scrollToEnd();
  }

  function setTurnStatus(text) {
    if (!activeTurn) return;
    const label = String(text || "").trim();
    activeTurn.status.textContent = label;

    if (/taking longer/i.test(label)) {
      activeTurn.slowNote.hidden = false;
      activeTurn.slowNote.textContent = label;
      return;
    }

    activeTurn.slowNote.hidden = true;
    const index = TURN_STEPS.findIndex((step) => step.match.test(label));
    if (index < 0) return;

    if (/thinking about that one/i.test(label)) {
      activeTurn.stepNodes[3].textContent = "Thinking about that one";
    } else if (/choosing a few to watch/i.test(label)) {
      activeTurn.stepNodes[3].textContent = "Choosing a few to watch";
    }

    activeTurn.stepIndex = Math.max(activeTurn.stepIndex, index);
    for (let i = 0; i < activeTurn.stepNodes.length; i++) {
      const node = activeTurn.stepNodes[i];
      node.classList.toggle("is-done", i < activeTurn.stepIndex);
      node.classList.toggle("is-active", i === activeTurn.stepIndex);
      node.classList.toggle("is-pending", i > activeTurn.stepIndex);
    }
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
    if (!activeTurn.partial) activeTurn.stickToBottom = isNearBottom();
    else if (!isNearBottom()) activeTurn.stickToBottom = false;
    activeTurn.partial += text;
    if (streamFrame) return;
    if (typeof requestAnimationFrame === "function") {
      streamFrame = requestAnimationFrame(flushStreamFrame);
    } else {
      flushStreamFrame();
    }
  }

  function finishActivityShell({ complete = false, error = false } = {}) {
    if (!activeTurn) return;
    for (const node of activeTurn.stepNodes) {
      if (complete) {
        node.classList.remove("is-active", "is-pending");
        node.classList.add("is-done");
      }
    }
    activeTurn.steps.hidden = true;
    activeTurn.slowNote.hidden = true;
    activeTurn.status.classList.remove("visually-hidden");
    activeTurn.stop.hidden = true;
    activeTurn.elapsed.hidden = true;
    if (complete) activeTurn.wrap.classList.add("is-complete");
    if (error) activeTurn.wrap.classList.add("is-error");
  }

  function completeTurn({ reply, timing, catalogCount = null } = {}) {
    if (!activeTurn) return;
    cancelStreamFrame();
    activeTurn.response.hidden = false;
    activeTurn.response.textContent = "";
    activeTurn.response.appendChild(renderMarkdown(parseMarkdown(reply || ""), document));
    const matches = activeTurn.toolCounts.reduce((total, count) => total + count, 0);
    const summary = [];
    if (Number.isFinite(catalogCount) && catalogCount >= 0) summary.push(catalogCount.toLocaleString("en-IN") + " titles");
    if (matches > 0) summary.push(matches + " matches");
    if (Number.isFinite(timing?.totalMs)) summary.push((timing.totalMs / 1000).toFixed(1) + "s");
    finishActivityShell({ complete: true });
    activeTurn.status.textContent = summary.join(" · ") || "Complete";
    if (activeTurn.stickToBottom || isNearBottom()) scrollToEnd();
    activeTurn = null;
  }

  function failTurn({ message, partialReply = "", timing, status = "Could not complete" } = {}) {
    if (!activeTurn) return;
    cancelStreamFrame();
    const partial = String(partialReply || activeTurn.partial || "");
    if (partial) {
      activeTurn.response.hidden = false;
      activeTurn.response.textContent = partial;
    }
    finishActivityShell({ error: true });
    activeTurn.status.textContent = status;
    activeTurn.error.textContent = String(message || "The turn did not complete. Check your connection or API key in Settings, then try again.");
    activeTurn.error.hidden = false;
    if (Number.isFinite(timing?.totalMs)) {
      activeTurn.status.textContent = status + " · " + (timing.totalMs / 1000).toFixed(1) + "s";
    }
    if (activeTurn.stickToBottom || isNearBottom()) scrollToEnd();
    activeTurn = null;
  }

  function setNote(text) {
    const value = typeof text === "string" ? text.trim() : "";
    el.chatNote.textContent = value;
    el.chatNote.hidden = value === "";
  }

  function localCommandReady() {
    return !busy && typeof deps.isLocalCommand === "function" && deps.isLocalCommand(getQuery());
  }

  function syncSend() {
    const local = localCommandReady();
    el.sendBtn.disabled = busy || ((!keyAvailable || !sendReady) && !local);
  }

  function setBusy(nextBusy) {
    const restoreFocus = !nextBusy && document.activeElement === el.stopBtn;
    busy = nextBusy;
    el.chatRegion.setAttribute("aria-busy", busy ? "true" : "false");
    // Keep the composer editable during a turn so the next draft can be written
    // while this one runs; only submission is disabled until the turn ends.
    el.queryInput.disabled = false;
    el.chatFile.disabled = busy;
    syncSend();
    el.stopBtn.hidden = !busy;
    el.sendBtn.hidden = busy;
    el.queryForm.classList.toggle("is-turn-active", busy);
    if (restoreFocus) el.queryInput.focus();
  }

  function setSendReady(ready) {
    sendReady = Boolean(ready);
    syncSend();
  }

  function setKeyAvailable(available) {
    keyAvailable = Boolean(available);
    el.chatKeyError.hidden = keyAvailable;
    el.queryForm.setAttribute("aria-disabled", keyAvailable ? "false" : "true");
    syncSend();
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

  function restoreQueryIfEmpty(value) {
    if (getQuery() !== "") return;
    setQuery(value);
  }

  function acceptFile(file) {
    if (!file || typeof deps.onFile !== "function") return;
    deps.onFile(file);
  }

  el.queryForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (busy || el.sendBtn.disabled) return;
    deps.onSubmit();
  });
  el.queryInput.addEventListener("input", () => syncSend());
  el.queryInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    if (!busy && !el.sendBtn.disabled) el.queryForm.requestSubmit();
  });
  el.chatFile.addEventListener("change", () => {
    const file = el.chatFile.files && el.chatFile.files[0];
    el.chatFile.value = "";
    acceptFile(file);
  });
  el.queryForm.addEventListener("dragover", (event) => {
    const types = event.dataTransfer && event.dataTransfer.types;
    if (!types || ![...types].includes("Files")) return;
    event.preventDefault();
    el.queryForm.classList.add("is-drop-target");
  });
  el.queryForm.addEventListener("dragleave", (event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    el.queryForm.classList.remove("is-drop-target");
  });
  el.queryForm.addEventListener("drop", (event) => {
    const types = event.dataTransfer && event.dataTransfer.types;
    if (!types || ![...types].includes("Files")) return;
    event.preventDefault();
    el.queryForm.classList.remove("is-drop-target");
    acceptFile(event.dataTransfer.files && event.dataTransfer.files[0]);
  });
  el.stopBtn.addEventListener("click", () => deps.onStop());

  return {
    renderConversation,
    appendMessage,
    appendPicks,
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
    setQuery,
    restoreQueryIfEmpty
  };
}
