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
  let openMenuId = null;
  let renamingId = null;

  function conversationLabel(conversation, active) {
    const title = conversation?.title || "New conversation";
    return (active ? "Current: " : "") + title;
  }

  function closeMenus() {
    openMenuId = null;
    for (const menu of el.conversationListItems.querySelectorAll(".conversation-menu")) {
      menu.hidden = true;
    }
    for (const button of el.conversationListItems.querySelectorAll(".conversation-more")) {
      button.setAttribute("aria-expanded", "false");
    }
  }

  function stopRename() {
    renamingId = null;
  }

  function renderRenameForm(row, conversation) {
    row.textContent = "";
    row.className = "conversation-row is-renaming";
    row.dataset.conversationId = conversation?.id || "";

    const form = document.createElement("form");
    form.className = "conversation-rename-form";
    const label = document.createElement("label");
    label.className = "visually-hidden";
    label.htmlFor = "conversation-rename-" + (conversation?.id || "active");
    label.textContent = "Conversation name";
    const input = document.createElement("input");
    input.id = label.htmlFor;
    input.type = "text";
    input.maxLength = 72;
    input.value = conversation?.title || "";
    input.setAttribute("aria-label", "Conversation name");
    const actions = document.createElement("div");
    actions.className = "conversation-rename-actions";
    const save = document.createElement("button");
    save.type = "submit";
    save.textContent = "Save";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    actions.append(save, cancel);
    form.append(label, input, actions);
    row.appendChild(form);

    const finish = () => {
      stopRename();
      void deps.onRefreshConversations?.();
    };

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      save.disabled = true;
      cancel.disabled = true;
      try {
        await deps.onRenameConversation?.(conversation.id, input.value);
        finish();
      } catch (error) {
        save.disabled = false;
        cancel.disabled = false;
        deps.onError?.(error && error.message ? error.message : "Could not rename that conversation.");
        input.focus();
      }
    });
    cancel.addEventListener("click", finish);
    input.focus();
    input.select();
  }

  function renderConversationList(list) {
    el.conversationListItems.textContent = "";
    closeMenus();
    const active = list?.active;
    const entries = Array.isArray(list?.items) ? list.items : active ? [active] : [];
    for (const conversation of entries) {
      const isActive = conversation?.id === active?.id;
      const row = document.createElement("div");
      row.className = "conversation-row" + (isActive ? " is-active" : "");
      row.setAttribute("role", "listitem");
      row.dataset.conversationId = conversation?.id || "";

      if (renamingId && renamingId === conversation?.id) {
        renderRenameForm(row, conversation);
        el.conversationListItems.appendChild(row);
        continue;
      }

      const button = document.createElement("button");
      button.type = "button";
      button.className = "conversation-list-item";
      button.textContent = conversation?.title || "New conversation";
      button.setAttribute("aria-label", conversationLabel(conversation, isActive));
      button.title = conversation?.title || "New conversation";
      if (isActive) button.setAttribute("aria-current", "page");
      button.disabled = isActive || !conversation?.id;
      button.addEventListener("click", async () => {
        await deps.onActivateConversation?.(conversation.id);
        closeSidebar();
      });

      const more = document.createElement("button");
      more.type = "button";
      more.className = "conversation-more";
      more.setAttribute("aria-haspopup", "menu");
      more.setAttribute("aria-expanded", "false");
      more.setAttribute("aria-label", "Actions for " + (conversation?.title || "conversation"));
      more.title = "Conversation actions";
      more.textContent = "⋯";

      const menu = document.createElement("div");
      menu.className = "conversation-menu";
      menu.setAttribute("role", "menu");
      menu.hidden = true;

      const rename = document.createElement("button");
      rename.type = "button";
      rename.setAttribute("role", "menuitem");
      rename.textContent = "Rename";
      rename.addEventListener("click", () => {
        closeMenus();
        renamingId = conversation.id;
        renderConversationList(list);
      });

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "danger-action";
      remove.setAttribute("role", "menuitem");
      remove.textContent = "Delete";
      remove.addEventListener("click", async () => {
        closeMenus();
        const label = conversation?.title || "this conversation";
        if (!window.confirm("Delete “" + label + "”? This cannot be undone.")) return;
        try {
          await deps.onDeleteConversation?.(conversation.id);
          stopRename();
        } catch (error) {
          deps.onError?.(error && error.message ? error.message : "Could not delete that conversation.");
        }
      });

      menu.append(rename, remove);
      more.addEventListener("click", (event) => {
        event.stopPropagation();
        const opening = openMenuId !== conversation.id;
        closeMenus();
        if (!opening) return;
        openMenuId = conversation.id;
        menu.hidden = false;
        more.setAttribute("aria-expanded", "true");
      });

      row.append(button, more, menu);
      el.conversationListItems.appendChild(row);
    }
  }

  function renderSubscriptions(providers) {
    el.subscriptionsSummary.textContent = providers.length > 0
      ? providers.map(deps.providerLabel).join(", ")
      : "None selected yet.";
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
    const label = effective ? "Expand navigation" : "Collapse navigation";
    el.sidebarCollapse.setAttribute("aria-label", label);
    el.sidebarCollapse.title = label;
    el.sidebarCollapseIcon?.setAttribute(
      "d",
      effective ? "M4 4h7v16H4zM14 9l3 3-3 3" : "M4 4h7v16H4zM18 9l-3 3 3 3"
    );
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
    closeMenus();
    if (wasOpen && restoreFocus && mobileQuery.matches) el.sidebarToggle.focus();
  }

  function setBusy(busy) {
    for (const node of [
      el.newChatBtn,
      el.playlistsBtn,
      el.contextBtn,
      el.settingsBtn,
      el.subscriptionsEdit,
      ...el.conversationListItems.querySelectorAll("button")
    ]) {
      if (node) node.disabled = busy;
    }
  }

  function openSettingsFromSidebar() {
    deps.onOpenSettings?.();
    closeSidebar();
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
  document.addEventListener("click", (event) => {
    if (!el.conversationListItems.contains(event.target)) closeMenus();
  });
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
  if (el.subscriptionsEdit) {
    el.subscriptionsEdit.addEventListener("click", openSettingsFromSidebar);
  }

  syncAccessibility();
  applyCollapsed();

  return {
    renderConversationList,
    renderSubscriptions,
    setBusy,
    closeSidebar
  };
}
