export const WATCH_LATER_ID = "watch-later";

export const PLAYLIST_LIMITS = Object.freeze({
  playlists: 50,
  nameCharacters: 80,
  titleIds: 500
});

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIso(now) {
  const value = typeof now === "function" ? now() : now;
  const date = value instanceof Date ? value : new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function isIsoDate(value) {
  return typeof value === "string" && ISO_DATE_RE.test(value) && !Number.isNaN(Date.parse(value));
}

function cleanName(value) {
  const name = typeof value === "string" ? value.trim() : "";
  return name && name.length <= PLAYLIST_LIMITS.nameCharacters ? name : "";
}

function nameKey(name) {
  return name.toLocaleLowerCase();
}

function cleanId(value) {
  const id = typeof value === "string" ? value.trim() : "";
  return id && id.length <= 200 && !/[\u0000-\u001f\u007f-\u009f]/.test(id) ? id : "";
}

function cleanTitleIds(value) {
  if (!Array.isArray(value)) return [];
  const ids = [];
  for (const item of value) {
    const id = cleanId(item);
    if (id && !ids.includes(id)) ids.push(id);
    if (ids.length === PLAYLIST_LIMITS.titleIds) break;
  }
  return ids;
}

function watchLater(now, value = {}) {
  const timestamp = nowIso(now);
  return {
    id: WATCH_LATER_ID,
    name: "Watch later",
    titleIds: cleanTitleIds(value.titleIds),
    createdAt: isIsoDate(value.createdAt) ? value.createdAt : timestamp,
    updatedAt: isIsoDate(value.updatedAt) ? value.updatedAt : timestamp
  };
}

function samePlaylist(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function withUpdatedAt(state, now) {
  return { ...state, updatedAt: nowIso(now) };
}

function safeState(state, now) {
  return sanitizePlaylists(state, now) || defaultPlaylists(now);
}

function findPlaylist(state, id) {
  const clean = cleanId(id);
  return clean ? state.playlists.find((playlist) => playlist.id === clean) || null : null;
}

function uniquePlaylistId(state, now) {
  const base = `playlist-${nowIso(now).replace(/\D/g, "") || "local"}`;
  let suffix = 1;
  let id = base;
  while (findPlaylist(state, id)) {
    suffix += 1;
    id = `${base}-${suffix}`;
  }
  return id;
}

export function defaultPlaylists(now) {
  const timestamp = nowIso(now);
  return {
    schema: 1,
    updatedAt: timestamp,
    playlists: [watchLater(now, { createdAt: timestamp, updatedAt: timestamp })]
  };
}

export function sanitizePlaylists(value, now) {
  if (!isPlainObject(value) || !Array.isArray(value.playlists)) return null;

  const watchLaterValue = value.playlists.find((playlist) => isPlainObject(playlist) && playlist.id === WATCH_LATER_ID);
  const playlists = [watchLater(now, watchLaterValue || {})];
  const ids = new Set([WATCH_LATER_ID]);
  const names = new Set([nameKey("Watch later")]);

  for (const candidate of value.playlists) {
    if (!isPlainObject(candidate) || candidate.id === WATCH_LATER_ID) continue;
    const id = cleanId(candidate.id);
    const name = cleanName(candidate.name);
    if (!id || !name || ids.has(id) || names.has(nameKey(name))) continue;
    playlists.push({
      id,
      name,
      titleIds: cleanTitleIds(candidate.titleIds),
      createdAt: isIsoDate(candidate.createdAt) ? candidate.createdAt : nowIso(now),
      updatedAt: isIsoDate(candidate.updatedAt) ? candidate.updatedAt : nowIso(now)
    });
    ids.add(id);
    names.add(nameKey(name));
    if (playlists.length === PLAYLIST_LIMITS.playlists) break;
  }

  return {
    schema: 1,
    updatedAt: isIsoDate(value.updatedAt) ? value.updatedAt : nowIso(now),
    playlists
  };
}

export function createPlaylist(state, name, { id, now } = {}) {
  const safe = safeState(state, now);
  const clean = cleanName(name);
  const playlistId = id === undefined ? uniquePlaylistId(safe, now) : cleanId(id);
  if (
    !clean ||
    !playlistId ||
    playlistId === WATCH_LATER_ID ||
    safe.playlists.length >= PLAYLIST_LIMITS.playlists ||
    findPlaylist(safe, playlistId) ||
    safe.playlists.some((playlist) => nameKey(playlist.name) === nameKey(clean))
  ) {
    return clone(safe);
  }

  const timestamp = nowIso(now);
  return withUpdatedAt({
    ...safe,
    playlists: safe.playlists.concat({
      id: playlistId,
      name: clean,
      titleIds: [],
      createdAt: timestamp,
      updatedAt: timestamp
    })
  }, now);
}

export function renamePlaylist(state, id, name, { now } = {}) {
  const safe = safeState(state, now);
  const playlist = findPlaylist(safe, id);
  const clean = cleanName(name);
  if (
    !playlist ||
    playlist.id === WATCH_LATER_ID ||
    !clean ||
    safe.playlists.some((item) => item.id !== playlist.id && nameKey(item.name) === nameKey(clean))
  ) {
    return clone(safe);
  }

  const updated = { ...playlist, name: clean, updatedAt: nowIso(now) };
  if (samePlaylist(playlist, updated)) return clone(safe);
  return withUpdatedAt({
    ...safe,
    playlists: safe.playlists.map((item) => item.id === playlist.id ? updated : item)
  }, now);
}

export function deletePlaylist(state, id, { now } = {}) {
  const safe = safeState(state, now);
  const playlist = findPlaylist(safe, id);
  if (!playlist || playlist.id === WATCH_LATER_ID) return clone(safe);
  return withUpdatedAt({
    ...safe,
    playlists: safe.playlists.filter((item) => item.id !== playlist.id)
  }, now);
}

export function addToPlaylist(state, id, titleId, { now } = {}) {
  const safe = safeState(state, now);
  const playlist = findPlaylist(safe, id);
  const clean = cleanId(titleId);
  if (!playlist || !clean || playlist.titleIds.includes(clean) || playlist.titleIds.length >= PLAYLIST_LIMITS.titleIds) {
    return clone(safe);
  }
  const updated = { ...playlist, titleIds: playlist.titleIds.concat(clean), updatedAt: nowIso(now) };
  return withUpdatedAt({
    ...safe,
    playlists: safe.playlists.map((item) => item.id === playlist.id ? updated : item)
  }, now);
}

export function removeFromPlaylist(state, id, titleId, { now } = {}) {
  const safe = safeState(state, now);
  const playlist = findPlaylist(safe, id);
  const clean = cleanId(titleId);
  if (!playlist || !clean || !playlist.titleIds.includes(clean)) return clone(safe);
  const updated = {
    ...playlist,
    titleIds: playlist.titleIds.filter((item) => item !== clean),
    updatedAt: nowIso(now)
  };
  return withUpdatedAt({
    ...safe,
    playlists: safe.playlists.map((item) => item.id === playlist.id ? updated : item)
  }, now);
}

export function playlistContains(state, id, titleId) {
  const playlist = findPlaylist(sanitizePlaylists(state) || defaultPlaylists(), id);
  const clean = cleanId(titleId);
  return Boolean(playlist && clean && playlist.titleIds.includes(clean));
}

export function playlistFilename(playlist, extension = "") {
  const source = isPlainObject(playlist) ? playlist : { name: playlist };
  const base = cleanName(source.name) || cleanId(source.id) || "playlist";
  const slug = base
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "playlist";
  const suffix = typeof extension === "string" ? extension.replace(/^[.]+/, "").replace(/[^a-z0-9]/gi, "") : "";
  return suffix ? `${slug}.${suffix.toLowerCase()}` : slug;
}
