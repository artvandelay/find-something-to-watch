import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import {
  WATCH_LATER_ID,
  PLAYLIST_LIMITS,
  addToPlaylist,
  createPlaylist,
  defaultPlaylists,
  deletePlaylist,
  playlistContains,
  playlistFilename,
  removeFromPlaylist,
  renamePlaylist,
  sanitizePlaylists
} from "../docs/js/playlists.js";

const timestamp = "2026-08-05T00:00:00.000Z";
const now = () => new Date(timestamp);

const defaults = defaultPlaylists(now);
strictEqual(defaults.schema, 1);
strictEqual(defaults.updatedAt, timestamp);
deepStrictEqual(defaults.playlists, [{
  id: WATCH_LATER_ID,
  name: "Watch later",
  titleIds: [],
  createdAt: timestamp,
  updatedAt: timestamp
}]);

const state = createPlaylist(defaults, "  Weekend movies  ", { id: "weekend", now });
strictEqual(state.playlists[1].name, "Weekend movies");
strictEqual(state.playlists[1].id, "weekend");
strictEqual(defaults.playlists.length, 1);

const duplicateName = createPlaylist(state, "weekend MOVIES", { id: "another", now });
strictEqual(duplicateName.playlists.length, 2);
const invalidId = createPlaylist(state, "Other", { id: "  ", now });
strictEqual(invalidId.playlists.length, 2);
const renamed = renamePlaylist(state, "weekend", "Friday films", { now });
strictEqual(renamed.playlists[1].name, "Friday films");
strictEqual(renamePlaylist(renamed, WATCH_LATER_ID, "Nope", { now }).playlists[0].name, "Watch later");
strictEqual(renamePlaylist(renamed, "weekend", "watch later", { now }).playlists[1].name, "Friday films");

const saved = addToPlaylist(renamed, WATCH_LATER_ID, " tmdb:m1 ", { now });
ok(playlistContains(saved, WATCH_LATER_ID, "tmdb:m1"));
strictEqual(addToPlaylist(saved, WATCH_LATER_ID, "tmdb:m1", { now }).playlists[0].titleIds.length, 1);
const removed = removeFromPlaylist(saved, WATCH_LATER_ID, "tmdb:m1", { now });
ok(!playlistContains(removed, WATCH_LATER_ID, "tmdb:m1"));
strictEqual(deletePlaylist(removed, WATCH_LATER_ID, { now }).playlists.length, 2);
strictEqual(deletePlaylist(removed, "weekend", { now }).playlists.length, 1);

let capped = defaultPlaylists(now);
for (let index = 0; index < PLAYLIST_LIMITS.playlists + 1; index += 1) {
  capped = createPlaylist(capped, `List ${index}`, { id: `list-${index}`, now });
}
strictEqual(capped.playlists.length, PLAYLIST_LIMITS.playlists);

let full = defaultPlaylists(now);
for (let index = 0; index < PLAYLIST_LIMITS.titleIds + 1; index += 1) {
  full = addToPlaylist(full, WATCH_LATER_ID, `tmdb:m${index}`, { now });
}
strictEqual(full.playlists[0].titleIds.length, PLAYLIST_LIMITS.titleIds);

const sanitized = sanitizePlaylists({
  schema: 1,
  updatedAt: timestamp,
  playlists: [
    { id: "later", name: "Later", titleIds: ["tmdb:m1", "tmdb:m1", " "], createdAt: timestamp, updatedAt: timestamp },
    { id: WATCH_LATER_ID, name: "Changed", titleIds: ["tmdb:m2"], createdAt: timestamp, updatedAt: timestamp },
    { id: "later", name: "Duplicate id", titleIds: [] },
    { id: "other", name: "WATCH LATER", titleIds: [] },
    { id: "good", name: "Good", titleIds: ["tmdb:m3"] }
  ]
}, now);
deepStrictEqual(sanitized.playlists.map((playlist) => playlist.id), [WATCH_LATER_ID, "later", "good"]);
deepStrictEqual(sanitized.playlists[0].titleIds, ["tmdb:m2"]);
strictEqual(sanitizePlaylists(null, now), null);

strictEqual(playlistFilename({ id: WATCH_LATER_ID, name: "Watch later" }, "md"), "watch-later.md");
strictEqual(playlistFilename("Friday films!", ".CSV"), "friday-films.csv");
strictEqual(playlistFilename("☕"), "playlist");

console.log("check_playlists OK");
