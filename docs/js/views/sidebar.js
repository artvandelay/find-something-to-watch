/**
 * Left sidebar: new chat, the single saved conversation, subscribed
 * providers, profile/context/settings entry points, and local-data actions.
 * Collapses into a drawer on narrow viewports via the sidebar-toggle button.
 */
export function createSidebarView(el, deps) {
  const mobileQuery = window.matchMedia("(max-width: 900px)");

  function renderConversationIndicator(messageCount) {
    el.conversationIndicator.textContent = messageCount > 0
      ? "Current conversation — " + messageCount + " message" + (messageCount === 1 ? "" : "s")
      : "No conversation yet";
  }

  function renderSubscriptions(providers) {
    el.subscriptionsSummary.textContent = providers.length > 0
      ? providers.map(deps.providerLabel).join(", ")
      : "None selected — open Settings to choose your services.";
  }

  function setCatalogStatus(text) {
    el.catalogStatus.textContent = text;
  }

  function isOpen() {
    return el.sidebar.classList.contains("open");
  }

  function syncAccessibility() {
    const hidden = mobileQuery.matches && !isOpen();
    el.sidebar.inert = hidden;
    el.sidebar.setAttribute("aria-hidden", hidden ? "true" : "false");
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
      el.importBackupBtn,
      el.clearDataBtn,
      el.playlistsBtn,
      el.contextBtn,
      el.settingsBtn
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
  mobileQuery.addEventListener("change", () => closeSidebar({ restoreFocus: false }));

  el.newChatBtn.addEventListener("click", () => {
    deps.onNewChat();
    closeSidebar();
  });
  el.playlistsBtn.addEventListener("click", () => {
    deps.onOpenPlaylists();
    closeSidebar();
  });
  el.exportBackupBtn.addEventListener("click", () => deps.onExportBackup());
  el.importBackupBtn.addEventListener("click", () => el.importBackupFile.click());
  el.importBackupFile.addEventListener("change", () => {
    const file = el.importBackupFile.files && el.importBackupFile.files[0];
    el.importBackupFile.value = "";
    if (file) deps.onImportBackup(file);
  });
  el.clearDataBtn.addEventListener("click", () => deps.onClearData());

  syncAccessibility();

  return {
    renderConversationIndicator,
    renderSubscriptions,
    setCatalogStatus,
    setBusy,
    closeSidebar
  };
}
