/**
 * Left panel: brand, current/recent conversations, subscribed providers, and
 * the profile/context/settings entry points.
 *
 * It has three widths. On desktop it is a 260px panel that the visitor can
 * collapse to a 56px icon rail (persisted); below 1280px it auto-collapses to
 * that rail; below 900px it becomes an overlay drawer toggled by
 * #sidebar-toggle, where the collapsed rail does not apply.
 */
export function createSidebarView(el, deps) {
  const mobileQuery = window.matchMedia("(max-width: 900px)");
  const compactQuery = window.matchMedia("(max-width: 1280px)");
  let collapsed = deps.getCollapsed() === true || compactQuery.matches;

  function conversationLabel(conversation, active) {
    const title = conversation?.title || "New conversation";
    const count = Array.isArray(conversation?.messages) ? conversation.messages.length : 0;
    return (active ? "Current: " : "") + title + (count ? ` — ${count} messages` : "");
  }

  function renderConversationList(list) {
    el.conversationListItems.textContent = "";
    const active = list?.active;
    const entries = Array.isArray(list?.items) ? list.items : active ? [active] : [];
    for (const conversation of entries) {
      const isActive = conversation?.id === active?.id;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "conversation-list-item";
      button.setAttribute("role", "listitem");
      button.dataset.conversationId = conversation?.id || "";
      button.textContent = conversationLabel(conversation, isActive);
      button.disabled = isActive || !conversation?.id;
      if (isActive) button.setAttribute("aria-current", "page");
      button.addEventListener("click", async () => {
        await deps.onActivateConversation?.(conversation.id);
        closeSidebar();
      });
      el.conversationListItems.appendChild(button);
    }
  }

  function renderSubscriptions(providers) {
    el.subscriptionsSummary.textContent = providers.length > 0
      ? providers.map(deps.providerLabel).join(", ")
      : "None selected — open Settings to choose your services.";
  }

  function isOpen() {
    return el.sidebar.classList.contains("open");
  }

  function syncAccessibility() {
    const hidden = mobileQuery.matches && !isOpen();
    el.sidebar.inert = hidden;
    el.sidebar.setAttribute("aria-hidden", hidden ? "true" : "false");
  }

  // The drawer always shows full labels, so the icon rail is desktop-only.
  function applyCollapsed() {
    const effective = !mobileQuery.matches && collapsed;
    el.shell.classList.toggle("sidebar-collapsed", effective);
    el.sidebarCollapse.setAttribute("aria-expanded", effective ? "false" : "true");
    const label = effective ? "Expand sidebar" : "Collapse sidebar";
    el.sidebarCollapse.setAttribute("aria-label", label);
    el.sidebarCollapse.title = label;
  }

  function openSidebar() {
    el.sidebar.classList.add("open");
    el.sidebarToggle.setAttribute("aria-expanded", "true");
    el.backdrop.hidden = false;
    syncAccessibility();
    el.newChatBtn.focus();
  }

  function closeSidebar({ restoreFocus = true } = {}) {
    const wasOpen = isOpen();
    el.sidebar.classList.remove("open");
    el.sidebarToggle.setAttribute("aria-expanded", "false");
    el.backdrop.hidden = true;
    syncAccessibility();
    if (wasOpen && restoreFocus && mobileQuery.matches) el.sidebarToggle.focus();
  }

  function setBusy(busy) {
    for (const node of [
      el.newChatBtn,
      el.playlistsBtn,
      el.contextBtn,
      el.settingsBtn,
      ...el.conversationListItems.querySelectorAll("button")
    ]) {
      node.disabled = busy;
    }
  }

  el.sidebarToggle.addEventListener("click", () => {
    if (isOpen()) closeSidebar(); else openSidebar();
  });
  el.backdrop.addEventListener("click", closeSidebar);
  function closeOnEscape(event) {
    if ((event.key === "Escape" || event.key === "Esc") && isOpen()) {
      event.preventDefault();
      closeSidebar();
    }
  }

  document.addEventListener("keydown", closeOnEscape);
  el.sidebar.addEventListener("keyup", closeOnEscape);
  mobileQuery.addEventListener("change", () => {
    closeSidebar({ restoreFocus: false });
    applyCollapsed();
  });
  compactQuery.addEventListener("change", (event) => {
    // Narrow viewports auto-collapse; widening restores the saved preference.
    collapsed = event.matches ? true : deps.getCollapsed() === true;
    applyCollapsed();
  });

  el.sidebarCollapse.addEventListener("click", () => {
    collapsed = !collapsed;
    deps.setCollapsed(collapsed);
    applyCollapsed();
  });

  el.newChatBtn.addEventListener("click", () => {
    deps.onNewChat();
    closeSidebar();
  });
  el.playlistsBtn.addEventListener("click", () => {
    deps.onOpenPlaylists();
    closeSidebar();
  });

  syncAccessibility();
  applyCollapsed();

  return {
    renderConversationList,
    renderSubscriptions,
    setBusy,
    closeSidebar
  };
}
