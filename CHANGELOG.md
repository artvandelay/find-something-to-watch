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

### Changed

- Settings keeps the full curated subscription list available after save (subscription-scoped
  catalog metadata no longer hides unselected services), persists provider changes before
  catalog refresh work, and uses a searchable multi-select with removable provider chips
  instead of a large checkbox grid. The model picker’s “Other model ID” control sits in a
  proper panel footer instead of overlapping the list.
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
