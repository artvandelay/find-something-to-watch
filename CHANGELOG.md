# Changelog

All notable changes to this project will be documented here.

## [0.1.0] - Unreleased

### Added

- Static search across 26 curated India streaming providers for a bring-your-own-compatible-model hobby
  project.
- Worker-backed `run_catalog_js` catalog analysis with subscription-scoped projections, observed-ID
  queue grounding, and disposable-executor fault containment. The executor is not a hostile-code
  security sandbox.
- Schema-2 TMDB catalog snapshot with 31,884 deduplicated titles.
- Language, genre, provider, year, runtime, kind, and TMDB rating filters.
- Lazy-loaded synopsis sidecar and vote-weighted BM25 ranking.
- Direct-to-workspace first visit with a clear Settings-based subscription and API-key gate.
- Optional CSV/JSON/ZIP watch-history import from Profile & context.
- Provider-agnostic local history import with bounded, model-assisted schema inference; complete uploads
  stay in the browser.
- Persistent named playlists, including immutable Watch later, with Markdown, JSON, and CSV exports.
- Synopsis-rich recommendation cards and safe lightweight Markdown assistant replies.
- Browser-local persistence for profile, conversation, queue, You.md, history, and playlists.
- Shared title details with snapshot provenance and an all-curated-provider exception: providers are grouped
  into selected subscriptions and other known platforms.
- Ranked decisions with one Top pick, two Alternatives, and collapsed More options instead of
  equal-weight recommendations.
- Archived conversations with their ranked decisions, plus structured learned entertainment preferences
  that users can inspect, edit, disable, or clear separately from You.md.
- Streaming turn phases, attached activity checklist, Stop and slow-turn states, and
  latency/token metrics with provider-reported cost (developer Trace only).
- Pick-card taste feedback: more like this, not for me, already seen, and not tonight, with a
  visible confirmation when preferences are learned.
- Offline hostile-input, catalog-integrity, and search-performance stress suites.
- Live OpenRouter agent stress harness.
- One continuous chat with a clock-aware welcome, suggestion chips, and a divider after a long gap.
- Free podcasts, films, and audiobooks from Open Culture, searchable with the paid catalog and marked Free.
- Learned viewing habits, titles you say you already watched, and a short recall of earlier chats.
- A "Can't open it" action on free titles that hides that title for this browser.
- A welcome line and a "What I remember" panel for learned facts, titles marked in chat, and imported
  history counts.
- Direct import of YouTube Takeout (JSON, HTML, or ZIP) and Netflix viewing-history CSV, without the model.
- A region setting, default India, that hides free links known to fail there and opens Apple links in
  that region's store.
- "Start over (keep API key)" in Settings, and the same action from `?reset`. "Clear everything" still
  removes the API key.

- The assistant decides how many titles go on the rail and whether they replace the list or
  are added after it (`queue`, `queueMode`, `showAll`). The screen does not guess that from
  the message. **Ask for more picks** only sends "More, please".
- Taste actions on a pick are an icon row (more like this, not for me, already seen, dismiss,
  and can't open it on free titles). Dismiss only removes the title from the current list.
  The words stay in the accessible name and a tooltip.
- A "Skip to conversation" link is the first keyboard stop in the app.

### Changed

- Pick reasons are shown in full. The plot line on a card can still be shortened; the title
  opens the full synopsis.
- New chat is a neutral button. Send stays the filled primary.
- Body text and the composer are 16px.
- Light mode has its own success color. Danger is a separate crimson from the tomato accent,
  and destructive buttons use that color for the border.
- Errors that stop a turn, a save, or a reset say what to do next.
- The profile toggle says "Remember what you like between chats". Empty learned facts and
  empty playlists say how they get filled.

- Watch history attached in chat is read by asking the model for a layout, generating a reader from that
  layout, and running it in a disposable worker. The reply states the counts, or the error if the layout
  or the file fails. Saved history is left unchanged on failure.
- Watch history is added in the chat. The reply states what was read, or the parser error if the file
  could not be read. Profile & context keeps the imported counts and Remove imported history.
- Settings remains the place to edit subscriptions after chat starts; the sidebar now has
  an Edit control, and subscription changes reseed or rescope the picks rail.
- Conversations can be renamed or deleted from the sidebar, with deletes confirmed and the
  active chat swapped to another thread or a new empty one.
- Seeded and agent picks hide titles already in imported watch history unless the ask is an
  explicit rewatch; filler “Selected from your catalog…” reasons no longer clutter cards.
- Picks rail polish: poster-forward Top pick, quieter alternatives, calmer empty states, and
  taste feedback on each card.
- Chat activity now shows a checking-off milestone timeline instead of a single status line,
  and buries token/cost telemetry in the developer Trace.
- Perceived responsiveness: parallel IndexedDB/manifest prep, Worker-owned catalog
  indexing with HTTP cache semantics, turn classes (`direct` / `normal` / `complex`),
  editable composer during turns, rAF-batched streaming, and user-facing milestones.
  See `docs/LATENCY.md`.
- Ratings now use TMDB audience scores.
- Posters are shipped for titles with at least 10 TMDB votes; other titles use initials fallbacks.
- Provider labels, accessibility contrast, focus states, and loading states were updated.
- The visible composer is now natural-language-only; provider, language, genre, and mood intent remain
  available to the agent's subscription-gated catalog tools.
- The shell is now three vertical panels: a collapsible sidebar (persisted, auto-collapsing below
  1280px), a chat column with the composer pinned to the bottom and message text capped at a readable
  measure, and a vertically scrolling picks rail of compact card rows instead of a paged grid.
- The picks rail can be resized, collapsed, and restored on desktop; its layout persists across reloads.
- Backup export and clear-local-data moved from the sidebar into Settings under **Local data**, and
  the catalog snapshot line moved to a quiet footer under the picks rail.
- Learned preference candidates now require model-produced explicit/durable decisions and literal
  latest-query evidence; local validation does not infer preference semantics from keywords.
- Browser-memory backups are export-only in this version.
- The playlists dialog is now progressive — library, playlist detail, and create are separate views,
  with rename, delete, and export behind a More control instead of one long form.
- Product and privacy copy now states that data is stored in the browser while relevant context is sent
  to the configured model endpoint. It labels availability as a dated catalog snapshot and preserves
  the disposable-Worker fault-containment caveat.
- The product and repository are named **Find Something to Watch**.

### Verification

- Catalog and synopsis validators pass.
- The npm module-check suite passes.
- Data-integrity and performance suites pass.
- Hostile agent suite passes 12/12 cases without network access.
- Live OpenRouter suite passed 24/24 release-candidate queries.
- Eager catalog payload is under 2 MB gzipped.
