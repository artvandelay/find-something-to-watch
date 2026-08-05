/**
 * Playlists dialog. One dialog, four mutually exclusive views:
 *
 *   picker  — compact add/remove checklist opened from a pick's + button
 *   library — every playlist as a row (name + saved count), Watch later first
 *   detail  — one playlist's saved titles; rename/delete/export live behind More
 *   create  — a single name field and Create, nothing else
 *
 * State is rendered by the coordinator after every persisted domain mutation;
 * this view only owns which view is showing and the interactions inside it.
 */
const WATCH_LATER_ID = "watch-later";

export function createPlaylistsView(el, deps) {
  let state = { playlists: [] };
  let view = "library";
  let picker = null;
  let selectedPlaylistId = "";
  let moreOpen = false;
  let exportOpen = false;
  let renaming = false;
  let restoreFocusTo = null;
  let busy = false;

  function playlists() {
    return Array.isArray(state.playlists) ? state.playlists : [];
  }

  function selectedPlaylist() {
    return playlists().find((playlist) => playlist.id === selectedPlaylistId) || null;
  }

  function feedback(message = "") {
    el.playlistFeedback.textContent = message;
    el.playlistFeedback.hidden = message === "";
  }

  function messageFor(error, fallback) {
    return error && error.message ? error.message : fallback;
  }

  function titleCount(playlist) {
    return playlist && Array.isArray(playlist.titleIds) ? playlist.titleIds.length : 0;
  }

  function countLabel(count) {
    return count === 0 ? "No saved titles" : count + " saved title" + (count === 1 ? "" : "s");
  }

  function resolveTitle(titleId) {
    const resolve = typeof state.resolveTitle === "function"
      ? state.resolveTitle
      : typeof deps.resolveTitle === "function" ? deps.resolveTitle : null;
    if (resolve) return resolve(titleId);

    for (const source of [state.resolved, state.resolvedItems, state.items, state.recordsById]) {
      if (source instanceof Map && source.has(titleId)) return source.get(titleId);
      if (source && typeof source === "object" && !Array.isArray(source) && source[titleId]) return source[titleId];
      if (Array.isArray(source)) {
        const record = source.find((item) => item && item.id === titleId);
        if (record) return record;
      }
    }
    return null;
  }

  function setBusy(next) {
    busy = next;
    for (const node of [
      el.playlistBack,
      el.playlistNew,
      el.playlistMore,
      el.playlistRename,
      el.playlistDelete,
      el.playlistExport,
      el.playlistExportMd,
      el.playlistExportJson,
      el.playlistExportCsv,
      el.playlistRenameName,
      el.playlistRenameSave,
      el.playlistRenameCancel,
      el.playlistCreateName,
      el.playlistCreate,
      el.playlistsClose
    ]) {
      node.disabled = next;
    }
    for (const input of el.playlistPickerList.querySelectorAll("input")) input.disabled = next;
    for (const button of el.playlistLibraryList.querySelectorAll("button")) button.disabled = next;
    for (const button of el.playlistItems.querySelectorAll("button")) button.disabled = next;
  }

  // ---- Picker -------------------------------------------------------------

  function renderPicker() {
    el.playlistPickerList.textContent = "";
    const titleId = picker && picker.titleId;
    if (!titleId) return;

    for (const playlist of playlists()) {
      const option = document.createElement("label");
      option.className = "playlist-picker-option";

      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = Array.isArray(playlist.titleIds) && playlist.titleIds.includes(titleId);
      input.disabled = busy;
      input.addEventListener("change", async () => {
        const checked = input.checked;
        setBusy(true);
        feedback();
        try {
          await deps.onToggle(playlist.id, titleId, checked);
          feedback(checked ? `Saved to ${playlist.name}.` : `Removed from ${playlist.name}.`);
        } catch (error) {
          input.checked = !checked;
          feedback(messageFor(error, "Could not update that playlist."));
        } finally {
          setBusy(false);
        }
      });

      const text = document.createElement("span");
      text.textContent = playlist.name;
      option.append(input, text);
      el.playlistPickerList.appendChild(option);
    }
  }

  // ---- Library ------------------------------------------------------------

  function renderLibrary() {
    const list = playlists();
    el.playlistLibraryList.textContent = "";

    for (const playlist of list) {
      const row = document.createElement("div");
      row.setAttribute("role", "listitem");

      const button = document.createElement("button");
      button.type = "button";
      button.className = "playlist-row";
      button.dataset.playlistId = playlist.id;
      button.disabled = busy;
      const count = titleCount(playlist);
      button.setAttribute("aria-label", `${playlist.name}, ${countLabel(count).toLowerCase()}`);

      const name = document.createElement("span");
      name.className = "playlist-row-name";
      name.textContent = playlist.name;

      const meta = document.createElement("span");
      meta.className = "playlist-row-count";
      meta.textContent = count === 0 ? "Empty" : String(count);

      const chevron = document.createElement("span");
      chevron.className = "playlist-row-chevron";
      chevron.setAttribute("aria-hidden", "true");
      chevron.textContent = "›";

      button.append(name, meta, chevron);
      button.addEventListener("click", () => showDetail(playlist.id));
      row.appendChild(button);
      el.playlistLibraryList.appendChild(row);
    }

    const nothingSaved = list.every((playlist) => titleCount(playlist) === 0);
    const onlyWatchLater = list.length <= 1;
    el.playlistLibraryEmpty.hidden = !(nothingSaved && onlyWatchLater);
    el.playlistLibraryEmpty.textContent = "Nothing saved yet — use the + on any pick to save it here, "
      + "or start a new playlist.";
  }

  // ---- Detail -------------------------------------------------------------

  function renderItems(playlist) {
    el.playlistItems.textContent = "";
    if (!playlist || titleCount(playlist) === 0) {
      const empty = document.createElement("p");
      empty.className = "note";
      empty.textContent = "No saved titles in this playlist yet.";
      el.playlistItems.appendChild(empty);
      return;
    }

    for (const titleId of playlist.titleIds) {
      const record = resolveTitle(titleId);
      const item = document.createElement("article");
      item.setAttribute("role", "listitem");

      const details = document.createElement("div");
      const title = document.createElement("button");
      title.type = "button";
      title.className = "playlist-title";
      title.dataset.titleId = titleId;
      title.textContent = record && (record.t || record.title) ? (record.t || record.title) : titleId;
      title.setAttribute("aria-label", "View details for " + title.textContent);
      title.addEventListener("click", () => deps.onOpenTitleDetails?.(titleId, title));
      details.appendChild(title);
      if (!record) {
        const unavailable = document.createElement("p");
        unavailable.className = "note";
        unavailable.textContent = "Unavailable on your current subscriptions.";
        details.appendChild(unavailable);
      }
      item.appendChild(details);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "playlist-item-remove";
      remove.textContent = "Remove";
      remove.disabled = busy;
      remove.setAttribute("aria-label", `Remove ${title.textContent} from ${playlist.name}`);
      remove.addEventListener("click", async () => {
        setBusy(true);
        feedback();
        try {
          await deps.onRemove(playlist.id, titleId);
          feedback(`Removed from ${playlist.name}.`);
        } catch (error) {
          feedback(messageFor(error, "Could not remove that title."));
        } finally {
          setBusy(false);
        }
      });
      item.appendChild(remove);
      el.playlistItems.appendChild(item);
    }
  }

  function renderDetail() {
    const playlist = selectedPlaylist();
    if (!playlist) {
      showLibrary();
      return;
    }
    const isProtected = playlist.id === WATCH_LATER_ID;

    el.playlistDetail.setAttribute("aria-label", playlist.name);
    el.playlistDetailCount.textContent = countLabel(titleCount(playlist));
    renderItems(playlist);

    el.playlistMore.setAttribute("aria-expanded", moreOpen ? "true" : "false");
    el.playlistActions.hidden = !moreOpen || renaming;
    el.playlistRename.hidden = isProtected;
    el.playlistDelete.hidden = isProtected;
    el.playlistExport.setAttribute("aria-expanded", exportOpen ? "true" : "false");
    el.playlistExportFormats.hidden = !exportOpen;

    el.playlistRenameForm.hidden = !renaming;
    el.playlistMore.hidden = renaming;
  }

  // ---- View switching -----------------------------------------------------

  function renderCurrentView() {
    el.playlistPicker.hidden = view !== "picker";
    el.playlistLibrary.hidden = view !== "library";
    el.playlistDetail.hidden = view !== "detail";
    el.playlistCreateView.hidden = view !== "create";
    el.playlistBack.hidden = view !== "detail" && view !== "create";

    if (view === "picker") {
      el.playlistsDialogTitle.textContent = "Save to playlist";
      const name = picker && picker.title ? `: ${picker.title}` : "";
      el.playlistPickerTitle.textContent = `Save to a playlist${name}`;
      renderPicker();
      return;
    }
    if (view === "create") {
      el.playlistsDialogTitle.textContent = "New playlist";
      return;
    }
    if (view === "detail") {
      const playlist = selectedPlaylist();
      el.playlistsDialogTitle.textContent = playlist ? playlist.name : "Your playlists";
      renderDetail();
      return;
    }
    el.playlistsDialogTitle.textContent = "Your playlists";
    renderLibrary();
  }

  function focusFirst(...candidates) {
    for (const node of candidates) {
      if (node && !node.hidden && !node.disabled && typeof node.focus === "function") {
        node.focus();
        return;
      }
    }
  }

  function showLibrary({ focus = true } = {}) {
    view = "library";
    moreOpen = false;
    exportOpen = false;
    renaming = false;
    renderCurrentView();
    if (focus) {
      const previous = el.playlistLibraryList
        .querySelector(`[data-playlist-id="${cssEscape(selectedPlaylistId)}"]`);
      focusFirst(previous, el.playlistLibraryList.querySelector("button"), el.playlistNew);
    }
    selectedPlaylistId = "";
  }

  function showDetail(playlistId, { focus = true } = {}) {
    selectedPlaylistId = playlistId;
    view = "detail";
    moreOpen = false;
    exportOpen = false;
    renaming = false;
    feedback();
    renderCurrentView();
    if (focus) focusFirst(el.playlistBack);
  }

  function showCreate() {
    view = "create";
    feedback();
    el.playlistCreateName.value = "";
    renderCurrentView();
    focusFirst(el.playlistCreateName);
  }

  function cssEscape(value) {
    return String(value).replace(/["\\]/g, "\\$&");
  }

  function render(nextState) {
    state = nextState && typeof nextState === "object" ? nextState : { playlists: [] };
    if (!el.playlistsDialog.open) return;
    if (view === "detail" && !selectedPlaylist()) {
      showLibrary({ focus: false });
      return;
    }
    renderCurrentView();
  }

  function restoreFocus() {
    const node = restoreFocusTo;
    restoreFocusTo = null;
    if (node && node.isConnected && typeof node.focus === "function") node.focus();
  }

  function openPicker(titleId, title) {
    picker = { titleId, title };
    view = "picker";
    restoreFocusTo = document.activeElement;
    feedback();
    renderCurrentView();
    if (!el.playlistsDialog.open) el.playlistsDialog.showModal();
    focusFirst(el.playlistPickerList.querySelector("input"), el.playlistsClose);
  }

  function openManager() {
    picker = null;
    selectedPlaylistId = "";
    restoreFocusTo = document.activeElement;
    feedback();
    view = "library";
    moreOpen = false;
    exportOpen = false;
    renaming = false;
    renderCurrentView();
    if (!el.playlistsDialog.open) el.playlistsDialog.showModal();
    focusFirst(el.playlistLibraryList.querySelector("button"), el.playlistNew);
  }

  function close() {
    if (el.playlistsDialog.open) el.playlistsDialog.close();
    else restoreFocus();
  }

  async function runMutation(action, fallback) {
    setBusy(true);
    feedback();
    try {
      const result = await action();
      setBusy(false);
      return { ok: true, result };
    } catch (error) {
      setBusy(false);
      feedback(messageFor(error, fallback));
      return { ok: false, result: null };
    }
  }

  // ---- Wiring -------------------------------------------------------------

  el.playlistsClose.addEventListener("click", close);
  el.playlistsDialog.addEventListener("close", restoreFocus);

  el.playlistBack.addEventListener("click", () => {
    feedback();
    showLibrary();
  });

  el.playlistNew.addEventListener("click", showCreate);

  el.playlistCreate.addEventListener("click", async () => {
    const name = el.playlistCreateName.value.trim();
    if (!name) {
      feedback("Enter a name for the new playlist.");
      el.playlistCreateName.focus();
      return;
    }
    const known = new Set(playlists().map((playlist) => playlist.id));
    const outcome = await runMutation(() => deps.onCreate(name), "Could not create that playlist.");
    if (!outcome.ok) return;

    const created = playlists().find((playlist) => !known.has(playlist.id));
    if (!created) {
      feedback("A playlist with that name already exists.");
      el.playlistCreateName.focus();
      return;
    }
    el.playlistCreateName.value = "";
    showDetail(created.id);
    feedback(`Created ${created.name}.`);
  });

  el.playlistMore.addEventListener("click", () => {
    moreOpen = !moreOpen;
    if (!moreOpen) exportOpen = false;
    renderCurrentView();
    if (moreOpen) {
      focusFirst(el.playlistRename, el.playlistExport);
    }
  });

  el.playlistExport.addEventListener("click", () => {
    exportOpen = !exportOpen;
    renderCurrentView();
    if (exportOpen) focusFirst(el.playlistExportMd);
  });

  el.playlistRename.addEventListener("click", () => {
    const playlist = selectedPlaylist();
    if (!playlist || playlist.id === WATCH_LATER_ID) return;
    renaming = true;
    feedback();
    el.playlistRenameName.value = playlist.name;
    renderCurrentView();
    focusFirst(el.playlistRenameName);
  });

  el.playlistRenameCancel.addEventListener("click", () => {
    renaming = false;
    feedback();
    renderCurrentView();
    focusFirst(el.playlistMore);
  });

  el.playlistRenameSave.addEventListener("click", async () => {
    const playlist = selectedPlaylist();
    if (!playlist || playlist.id === WATCH_LATER_ID) return;
    const name = el.playlistRenameName.value.trim();
    if (!name) {
      feedback("Enter a new playlist name.");
      el.playlistRenameName.focus();
      return;
    }
    const outcome = await runMutation(
      () => deps.onRename(playlist.id, name),
      "Could not rename that playlist."
    );
    if (!outcome.ok) return;

    const updated = selectedPlaylist();
    if (!updated || updated.name !== name) {
      feedback("That name is already used by another playlist.");
      el.playlistRenameName.focus();
      return;
    }
    renaming = false;
    moreOpen = false;
    renderCurrentView();
    feedback(`Renamed to ${updated.name}.`);
    focusFirst(el.playlistMore);
  });

  el.playlistDelete.addEventListener("click", async () => {
    const playlist = selectedPlaylist();
    if (!playlist || playlist.id === WATCH_LATER_ID) return;
    const name = playlist.name;
    const outcome = await runMutation(
      () => deps.onDelete(playlist.id),
      "Could not delete that playlist."
    );
    if (!outcome.ok) return;
    selectedPlaylistId = "";
    showLibrary();
    feedback(`Deleted ${name}.`);
  });

  for (const [button, format] of [
    [el.playlistExportMd, "md"],
    [el.playlistExportJson, "json"],
    [el.playlistExportCsv, "csv"]
  ]) {
    button.addEventListener("click", async () => {
      const playlist = selectedPlaylist();
      if (!playlist) return;
      const outcome = await runMutation(
        () => deps.onExport(format, playlist.id),
        "Could not export that playlist."
      );
      if (outcome.ok) feedback(`Exported ${playlist.name}.`);
    });
  }

  return { render, openPicker, openManager, close };
}
