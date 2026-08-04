/**
 * Playlist picker and manager. State is rendered by the coordinator after every
 * persisted domain mutation; this view only owns dialog state and interactions.
 */
export function createPlaylistsView(el, deps) {
  let state = { playlists: [] };
  let mode = "manager";
  let picker = null;
  let selectedPlaylistId = "";
  let restoreFocusTo = null;
  let busy = false;

  function playlists() {
    return Array.isArray(state.playlists) ? state.playlists : [];
  }

  function selectedPlaylist() {
    return playlists().find((playlist) => playlist.id === selectedPlaylistId) || playlists()[0] || null;
  }

  function feedback(message = "") {
    el.playlistFeedback.textContent = message;
    el.playlistFeedback.hidden = message === "";
  }

  function messageFor(error, fallback) {
    return error && error.message ? error.message : fallback;
  }

  function setBusy(next) {
    busy = next;
    for (const node of [
      el.playlistSelect,
      el.playlistCreateName,
      el.playlistCreate,
      el.playlistRenameName,
      el.playlistRename,
      el.playlistDelete,
      el.playlistExportMd,
      el.playlistExportJson,
      el.playlistExportCsv,
      el.playlistsClose
    ]) {
      node.disabled = next;
    }
    for (const input of el.playlistPickerList.querySelectorAll("input")) input.disabled = next;
    for (const button of el.playlistItems.querySelectorAll("button")) button.disabled = next;
    if (mode === "manager") renderManager();
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

  function renderItems(playlist) {
    el.playlistItems.textContent = "";
    if (!playlist || !Array.isArray(playlist.titleIds) || playlist.titleIds.length === 0) {
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
      const title = document.createElement("strong");
      title.textContent = record && (record.t || record.title) ? (record.t || record.title) : titleId;
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

  function renderManager() {
    const list = playlists();
    if (!list.some((playlist) => playlist.id === selectedPlaylistId)) {
      selectedPlaylistId = list[0] ? list[0].id : "";
    }

    el.playlistSelect.textContent = "";
    for (const playlist of list) {
      const option = document.createElement("option");
      option.value = playlist.id;
      option.textContent = playlist.name;
      option.selected = playlist.id === selectedPlaylistId;
      el.playlistSelect.appendChild(option);
    }

    const playlist = selectedPlaylist();
    const protectedPlaylist = !playlist || playlist.id === "watch-later";
    el.playlistRenameName.value = playlist ? playlist.name : "";
    el.playlistRenameName.disabled = busy || protectedPlaylist;
    el.playlistRename.disabled = busy || protectedPlaylist;
    el.playlistDelete.disabled = busy || protectedPlaylist;
    el.playlistExportMd.disabled = busy || !playlist;
    el.playlistExportJson.disabled = busy || !playlist;
    el.playlistExportCsv.disabled = busy || !playlist;
    renderItems(playlist);
  }

  function renderDialog() {
    const pickerMode = mode === "picker";
    el.playlistPicker.hidden = !pickerMode;
    el.playlistManager.hidden = pickerMode;
    el.playlistsDialogTitle.textContent = pickerMode ? "Save to playlist" : "Playlists";
    if (pickerMode) {
      const name = picker && picker.title ? `: ${picker.title}` : "";
      el.playlistPickerTitle.textContent = `Save to a playlist${name}`;
      renderPicker();
    } else {
      renderManager();
    }
  }

  function render(nextState) {
    state = nextState && typeof nextState === "object" ? nextState : { playlists: [] };
    if (el.playlistsDialog.open) renderDialog();
  }

  function restoreFocus() {
    const node = restoreFocusTo;
    restoreFocusTo = null;
    if (node && node.isConnected && typeof node.focus === "function") node.focus();
  }

  function open(modeName, focusTarget) {
    mode = modeName;
    restoreFocusTo = document.activeElement;
    feedback();
    renderDialog();
    if (!el.playlistsDialog.open) el.playlistsDialog.showModal();
    const target = focusTarget();
    if (target && typeof target.focus === "function") target.focus();
  }

  function openPicker(titleId, title) {
    picker = { titleId, title };
    open("picker", () => el.playlistPickerList.querySelector("input"));
  }

  function openManager() {
    picker = null;
    open("manager", () => el.playlistSelect);
  }

  function close() {
    if (el.playlistsDialog.open) el.playlistsDialog.close();
    else restoreFocus();
  }

  async function runMutation(action, fallback) {
    setBusy(true);
    feedback();
    try {
      await action();
      feedback("Playlist updated.");
    } catch (error) {
      feedback(messageFor(error, fallback));
    } finally {
      setBusy(false);
    }
  }

  el.playlistsClose.addEventListener("click", close);
  el.playlistsDialog.addEventListener("close", restoreFocus);
  el.playlistSelect.addEventListener("change", () => {
    selectedPlaylistId = el.playlistSelect.value;
    feedback();
    renderManager();
  });
  el.playlistCreate.addEventListener("click", () => {
    const name = el.playlistCreateName.value.trim();
    if (!name) {
      feedback("Enter a name for the new playlist.");
      el.playlistCreateName.focus();
      return;
    }
    runMutation(async () => {
      await deps.onCreate(name);
      el.playlistCreateName.value = "";
    }, "Could not create that playlist.");
  });
  el.playlistRename.addEventListener("click", () => {
    const playlist = selectedPlaylist();
    const name = el.playlistRenameName.value.trim();
    if (!playlist || playlist.id === "watch-later") return;
    if (!name) {
      feedback("Enter a new playlist name.");
      el.playlistRenameName.focus();
      return;
    }
    runMutation(() => deps.onRename(playlist.id, name), "Could not rename that playlist.");
  });
  el.playlistDelete.addEventListener("click", () => {
    const playlist = selectedPlaylist();
    if (!playlist || playlist.id === "watch-later") return;
    runMutation(async () => {
      await deps.onDelete(playlist.id);
      selectedPlaylistId = "";
    }, "Could not delete that playlist.");
  });
  for (const [button, format] of [
    [el.playlistExportMd, "md"],
    [el.playlistExportJson, "json"],
    [el.playlistExportCsv, "csv"]
  ]) {
    button.addEventListener("click", () => {
      const playlist = selectedPlaylist();
      if (!playlist) return;
      runMutation(() => deps.onExport(format, playlist.id), "Could not export that playlist.");
    });
  }

  return { render, openPicker, openManager, close };
}
