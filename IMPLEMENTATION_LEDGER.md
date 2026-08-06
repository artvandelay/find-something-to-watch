# Implementation ledger

This ledger records work performed under the gated OTT Agent UX execution plan. It
distinguishes the pre-existing Unscroll redesign working tree from changes made by
this plan. It is an implementation record, not a product specification.

## Baseline captured 2026-08-05

- Branch: `master`
- HEAD: `aa681f82920841c6587e9278cf8f547985303dd8` (`merge: integrate browser catalog agent harness`)
- Pre-existing uncommitted redesign files (preserved):
  - `CHANGELOG.md`
  - `CONTRACT.md`
  - `README.md`
  - `USER_GUIDE.md`
  - `docs/css/app.css`
  - `docs/index.html`
  - `docs/js/store.js`
  - `docs/js/ui.js`
  - `docs/js/views/dialogs.js`
  - `docs/js/views/playlists.js`
  - `docs/js/views/queue.js`
  - `docs/js/views/sidebar.js`
  - `scripts/check_app_boot.mjs`
- Pre-existing diff stat: 13 files changed, 1,260 insertions, 474 deletions.
- Deterministic baseline: `npm run check` passed on 2026-08-05. It ran 15
  `scripts/check_*.mjs` scripts; `check_app_boot.mjs` reported 91 passed and 0
  failed. The remaining 14 checks reported success.
- Final product name: **DEFERRED**. The existing visible wordmark is a temporary
  placeholder; no Phase 0 copy assigns a final product name.

## Phase 0 — Baseline, contract, and ledger

### Status
COMPLETE

### Completed
- Captured the baseline and created this ledger.
- Merged and froze the schema-3 catalog-details, ranked decision, conversation
  archive, learned-memory, streaming, billing, cancellation, and DOM contracts in
  `CONTRACT.md`.
- Preserved onboarding, history-import, playlists, Worker fault-containment, and
  subscription-scope contracts.
- Ran the Phase 0 deterministic gate; the app boot contract remains intact.

### Evidence
- `git status --short`
- `git diff --stat`
- Baseline `npm run check` — passed; 15 deterministic check scripts, including 91
  app-boot assertions.
- `git diff --check -- IMPLEMENTATION_LEDGER.md` — passed.
- `git diff --check -- CONTRACT.md` — passed.
- Phase 0 gate `npm run check` — passed on 2026-08-05; 15 deterministic check scripts
  passed, `check_app_boot.mjs` reported 91 passed and 0 failed, and the remaining 14
  checks reported success.

### Rough
- None known.

### Deferred
- Final product naming remains deferred by the frozen plan.

### Blocked
- None.

### Revisit
- Begin Phase 1 only after accepting this completed Phase 0 gate.

## Phase 1 — Catalog fidelity and shared title details

### Status
COMPLETE

### Completed
- Added deterministic catalog-fidelity coverage for unique IDs, frozen full-record
  fields, curated provider slugs, URL/provider membership, synopsis-sidecar IDs,
  main-thread display-field retention, and the Worker’s analytical projection boundary.
- Added one shared native title-details dialog. It resolves from full main-thread
  catalog records, groups every catalog provider into subscribed and other-known
  platforms, refreshes after synopsis merges or subscription changes, and restores
  focus after close.
- Added queue-card and playlist-title triggers while keeping provider links and save
  controls isolated from the details action.
- Added focused deterministic app coverage for full details, all-provider grouping,
  sidecar refresh, focus restoration, card/link/save isolation, playlist linkage, and
  a missing saved-title tombstone.
- Displayed catalog fields: poster (`img`), title (`t`), year (`y`), type (`k`),
  runtime (`rt`), TMDB rating/votes (`r`/`v`), language (`l`), genres (`g`),
  synopsis (`s`), IMDb (`im`), provider order/URLs (`p`/`u`), and snapshot
  provenance (`meta.region`, `meta.source`, `meta.built_at`).

### Evidence
- `node scripts/check_catalog_fidelity.mjs` — passed: 31,884 records; source
  display values present for posters=16,382, IMDb=29,203, ratings=26,776,
  votes=26,439, languages=30,947, and genres=28,750.
- `node scripts/check_app_boot.mjs` — passed: 102 passed, 0 failed.
- Phase 1 gate, in order: `node scripts/check_catalog_fidelity.mjs && node
  scripts/check_app_boot.mjs && npm run check` — passed on 2026-08-05.
  `npm run check` ran 16 deterministic check scripts; app boot again reported 102
  passed and 0 failed.
- Editor diagnostics for Phase 1 files — no linter errors.

### Rough
- Minimal functional details styling only; the Phase 5 visual redesign remains out of
  scope for this phase.

### Deferred
- Final visual polish belongs to Phase 5.
- Cast, directors, trailers, certification, pricing, provider logos, exhaustive
  real-time availability, and playback certainty are unavailable in the shipped
  catalog schema and intentionally not manufactured by this view.
- Ranked decisions, archived conversations, learned memory, streaming, and later
  phases were not started.

### Blocked
- None.

### Revisit
- Phase 2 may start: catalog fidelity, title-details integration, and all Phase 1
  gate checks passed.

## Phase 2 — Ranked decisions, archived conversations, and learned taste

### Status
COMPLETE

### Completed
- Added a pure ranked-decision domain with schema-2 `{ ids }` migration, bounded
  source queries/reasons, unique ranked IDs, fallback fit reasons, equality, and
  hydration helpers.
- Added structured learned-preference validation, merging, contradiction handling,
  bounded context rendering, and rejection of temporary or sensitive model inferences.
- Upgraded browser-memory logical records and backups to schema 3 while retaining
  IndexedDB version 1. Current conversations now have IDs/titles, inactive
  conversations retain their full ranked queue, and learned preferences are stored
  separately from manually authored You.md.
- Added atomic-in-process user-message, completed-turn, new-chat, archived-conversation
  activation, conversation-list, and context-memory APIs. New chats retain playlists,
  history, subscriptions, and configured model data.
- Replaced the sidebar's single-conversation indicator with an accessible active/recent
  conversation list. Added Profile & context controls to edit, remove, clear, or
  disable learned facts; You.md export includes a generated learned section.
- Wired immediate user-message persistence, New chat archiving, archived queue restore,
  ranked queue persistence, and enabled learned context into the coordinator. The
  existing no-key fallback now writes a ranked decision record.
- Added focused deterministic recommendation, preference, memory, and app-harness
  coverage for migrations, rollback, bounds, same-tab concurrency, reloads, archive
  switching, queue restoration, learned-memory editing/disable/clear, and backups.

### Evidence
- `node scripts/check_recommendations.mjs` — passed.
- `node scripts/check_preferences.mjs` — passed.
- `node scripts/check_memory.mjs` — passed, including schema-1/schema-2 migration,
  malformed-backup rollback, bounds, stale-ID rejection, archive restore, and
  same-instance concurrent appends.
- `node scripts/check_app_boot.mjs` — passed: 110 passed, 0 failed. It covers reload,
  New chat, archived-conversation switching, queue restoration, and learned-memory
  edit/disable/clear without a live model call.
- Phase 2 integration gate: `npm run check` — passed on 2026-08-05. All 18
  deterministic check scripts passed; app boot reported 110 passed and 0 failed.
- `git diff --check` and `node --check` for all Phase 2 modified JS/MJS files — passed.
- Editor diagnostics for Phase 2 files — no linter errors.

### Rough
- Writes are serialized within one browser-memory adapter instance. Separate tabs do
  not yet perform a conflict merge or user-visible conflict resolution; the latest
  write can win. This is logged for Phase 7 review and did not affect deterministic
  single-tab behavior.

### Deferred
- Streaming agent events, model-produced ranked reasons/memory candidates, visible
  turn activity, and the Top pick/Alternatives/More presentation remain Phase 3–4
  work and were not started here.
- Final visual redesign remains Phase 5 work.

### Blocked
- None.

### Revisit
- Phase 3 may start. Preserve the Phase 2 queue, conversation, and learned-memory
  schemas; revisit the cross-tab conflict policy in Phase 7.

## Phase 3 — Streaming transport, agent protocol, and real cancellation

### Status
COMPLETE

### Completed
- Added an OpenAI-compatible SSE client for agent turns while preserving the
  non-streaming history-import client. It handles chunk splits, CRLF, multiline
  data, comments, `[DONE]`, terminal usage, fragmented parallel tool calls,
  bounded retained data, and reader cancellation.
- Propagated the same `AbortSignal` through tool handlers and runtime calls.
- Upgraded the catalog host/Worker protocol to v2. Aborting removes the matching
  pending request, posts one v2 cancel, suppresses late responses, and keeps the
  trusted catalog host running. The Worker tracks and terminates only the matching
  disposable executor.
- Reworked agent calls to stream planning/tool-loop requests and the final
  presentation. Planning accepts strict internal decision JSON; final output is
  direct safe Markdown. Events now carry turn IDs, ordered phases, tool metadata,
  final deltas, timings, usage, and complete/incomplete provider-reported billing.
- Added ranked queue-reason and learned-memory-candidate validation before results
  leave the agent. Invalid/unobserved IDs and ungrounded/sensitive memory candidates
  are discarded.
- Expanded hostile coverage for UTF-8/SSE framing, oversized data, malformed
  decision JSON, missing `[DONE]`, midstream errors, abort/timeout partial text,
  unobserved IDs, memory-evidence attacks, and incomplete costs.

### Evidence
- Focused Phase 3 gate — `node scripts/check_llm_client.mjs && node
  scripts/check_tools.mjs && node scripts/check_catalog_runtime.mjs && node
  scripts/check_agent.mjs && node scripts/stress_agent_hostile.mjs` — passed on
  2026-08-05. Hostile stress reported 18/18 cases passed, 44 mocked fetch calls,
  and 0 global/network calls.
- Deterministic executor-cancellation path in `check_catalog_runtime.mjs` passed:
  the matching v2 cancel is posted once, the request rejects `AbortError`, its late
  response is ignored, and the trusted host is not restarted. The Worker assertion
  verifies that the matching active disposable executor is terminated.
- `npm run check` — passed on 2026-08-05: all deterministic `check_*.mjs` scripts
  passed; `check_app_boot.mjs` reported 110 passed and 0 failed.
- `git diff --check` and `node --check` for all Phase 3 JS/MJS files — passed.
- Timing: deterministic streamed-agent assertions recorded nonnegative total time
  and non-null TTFT (0–1 ms in in-memory fixtures; runner-dependent, not a live
  benchmark).
- Terminal `usage.cost`: present for every successful request in the deterministic
  agent fixture and aggregated to `$0.004` as provider-reported; hostile coverage
  also proves that a missing terminal cost yields unavailable billing.

### Rough
- No live timing benchmark was collected; deterministic TTFT/total-time values are
  transport-contract evidence only.

### Deferred
- The optional live OpenRouter stream was deliberately deferred. It is not needed
  for the deterministic gate, and no root `.env` value or model context was read or
  exposed.
- Attached streaming activity, Stop UI state, metrics display, and ranked decision
  rendering remain Phase 4 work and were not started.

### Blocked
- None.

### Revisit
- Phase 4 may start. Preserve the v2 cancellation and event contracts; use the
  Phase 4 deterministic harness before any browser/live-turn work.

## Phase 4 — Live turn UX and decisive recommendation surface

### Status
COMPLETE

### Completed
- Added attached assistant turn activity directly after the triggering user message:
  phase status, literal streamed text, elapsed time, slow-state warning, inline Stop/error
  states, compact success activity, and latency/token/reported-or-unavailable-cost footer.
- Added the ranked decision rail: Top pick, two Alternatives, a per-render collapsed
  More options control, source-query linkage, fit reasons, and existing title-details,
  save, metadata, and provider actions.
- Added a unique UI turn ID/generation guard; user messages persist before work starts;
  stale events after Stop, New chat, or conversation switching are ignored. Completed
  assistant messages, queues, metrics, and learned preferences now commit together in
  one browser-memory write.
- Added deterministic agent fixtures and app coverage for normal, delayed, stopped,
  failed, stale-event, reload, metrics, Markdown, ranked-rail, source-query, and
  cost-unavailable scenarios without a live model request.
- Added deterministic SSE fixtures in the local browser server for normal, delayed,
  cancelled, and failed browser turns.
- Fixed browser composer readiness: the required basic search index was scheduled only
  with an unbounded `requestIdleCallback`, which browsers may postpone indefinitely.
  The idle callback now has a 250 ms timeout, and the app harness asserts that bound.
- Expanded the deterministic browser fixture's observed catalog results so the normal
  browser turn proves Top pick, Alternatives, and More options with five real fixture
  records instead of a one-item rail.

### Evidence
- `node scripts/check_app_boot.mjs` — passed: 126 passed, 0 failed. It includes
  immediate persistence, ordered activity updates, literal deltas, safe final Markdown,
  Top/Alternatives/More hierarchy, source query, reasons, usage/cost, slow state,
  Stop, stale-event isolation, reload coverage, and bounded index-idle readiness.
- Phase 4 deterministic gate `npm run check` — passed on 2026-08-05. All
  `check_*.mjs` scripts passed; app boot reported 126 passed and 0 failed.
- `git diff --check` and `node --check` for every Phase 4 modified JS/MJS file —
  passed. Editor diagnostics for the same files — no errors.
- A real browser was opened against the local deterministic server with a fake local
  fixture key only; no root `.env` value or live OpenRouter request was used.
- Fresh browser boot reached `5 titles · snapshot 2026-08-05` with Send enabled;
  it no longer remained at `preparing search index…`.
- Browser normal scenario passed with streamed completion, five fixture records, Top
  pick, Alternatives, and collapsed More options. Slow scenario passed after the
  20-second attached `TAKING LONGER THAN USUAL` state retained Stop. Cancelled scenario
  passed with inline `Stopped.` and no global error. Failed scenario passed with the
  fixture HTTP 503 shown inline and no global error.

### Rough
- Functional Phase 4 styles only; the final visual redesign remains Phase 5 work.

### Deferred
- Live OpenRouter testing remains out of scope for Phase 4 and was not run.

### Blocked
- None.

### Revisit
- The Phase 4 browser gate is clear. Phase 5 may start, but no Phase 5 work was
  performed in this phase.

## Phase 5 — Rebellious futurist visual redesign

### Status
COMPLETE

### Completed
- Reworked the visual system around the frozen dark base, surface, border,
  foreground, muted, signal-crimson, and informational-blue hierarchy. System sans
  remains the body face; machine state and metrics remain monospace.
- Removed sidebar right-edge separation and shadow, sidebar-nav top separation,
  composer top separation, gradients, glow, decorative blur, button displacement,
  pill controls, and oversized rounded dashboard surfaces. The chat/decision rail
  separator remains the one primary structural divider.
- Made assistant prose unboxed, user messages compact, activity rows machine-like,
  Top pick dominant, Alternatives compact, and More options quiet. Dialogs and
  title details now use restrained, cinematic surfaces; playlist behavior is
  unchanged.
- Reorganized the sidebar: conversation history occupies the scrollable upper area;
  subscriptions and navigation are grouped in `.sidebar-bottom`, with
  subscriptions preceding and outside the navigation landmark. Replaced visible
  sidebar utility glyphs with accessible inline currentColor SVGs.
- Added deterministic structural assertions for sidebar order/placement, accessible
  SVG controls, Top/Alternatives/More labels, the real composer label, and native
  title-details semantics without adding jsdom layout assertions.

### Evidence
- `node scripts/check_app_boot.mjs` — passed: 132 passed, 0 failed, including the
  five Phase 5 structural assertions and the ranked-rail label assertion.
- Phase 5 integration `npm run check` — passed on 2026-08-05. All deterministic
  `check_*.mjs` scripts passed; app boot again reported 132 passed and 0 failed.
- `git diff --check -- docs/index.html docs/css/app.css scripts/check_app_boot.mjs`
  and `node --check scripts/check_app_boot.mjs` — passed.
- Real local deterministic-browser matrix passed with no horizontal overflow:
  1440×900 dark and light; 1100×844 dark and light; 900×844 dark and light; and
  390×844 dark and light. At desktop widths the sidebar has no right border and the
  composer has no top border; at 900/390 the drawer and stacked rail switch as
  expected. At 1440 reduced motion, transitions and animations computed to `0s`.
- Browser screenshot paths:
  - `/var/folders/2k/1_0dxy_172lgz4v0vwp65gb80000gp/T/cursor/screenshots/phase5-1440-dark.png`
  - `/var/folders/2k/1_0dxy_172lgz4v0vwp65gb80000gp/T/cursor/screenshots/phase5-1440-dark-ranked.png`
  - `/var/folders/2k/1_0dxy_172lgz4v0vwp65gb80000gp/T/cursor/screenshots/phase5-390-dark.png`

### Rough
- No material visual roughness observed in the required local fixture matrix. The
  browser screenshots use deterministic fixture posters/fallbacks, so final
  typography/artwork balance should be revisited only in the Phase 7 bounded
  polish pass, not by expanding this phase.

### Deferred
- Final product naming remains deferred by the frozen plan.
- Product/privacy copy and documentation work remain Phase 6 and were not started.

### Blocked
- None.

### Revisit
- Phase 5 gate is clear. Phase 6 may start; preserve this visual hierarchy and
  revisit any remaining subjective artwork/typography balance only during Phase 7.

## Phase 6 — Product and privacy communication

### Status
COMPLETE

### Completed
- Updated in-app onboarding, Settings, context-memory, catalog-provenance, document-title, and metadata
  copy to state the compatible-model, browser-storage, endpoint-transmission, dated-catalog, learned-memory,
  and Worker fault-containment contracts precisely.
- Preserved the required-key onboarding and the existing visible wordmark while removing final-name
  treatment from new technical and product documentation.
- Updated README and user guidance for the hobby/hacker posture, title-details provider exception, ranked
  Top pick/Alternatives/More model, archived conversations, structured learned preferences, streamed
  phases, Stop/slow behavior, and provider-reported or unavailable cost.
- Updated the changelog and release checklist with the frozen privacy/product claims and explicit
  Phase 1–5 release-gate checks.

### Evidence
- Phase 6 stale-claim searches on 2026-08-05:
  - `any agent` has no product-copy match; the sole match is unrelated shipped catalog synopsis text.
  - `nothing leaves` / `nothing is uploaded`, `estimated cost`, and `exactly one current conversation`
    have no matches.
  - `real-time availability` remains only as an explicit limitation in `CONTRACT.md` and this ledger,
    plus a historical quotation in research material; it is not claimed by product copy.
  - At the time of this check, `Unscroll` remained only in the preserved visible placeholder wordmark
    and the ledger's baseline description; no README, user-guide, changelog, metadata, or release-copy
    treatment presented it as final.
- `git diff --check -- docs/index.html docs/js/views/dialogs.js README.md USER_GUIDE.md CHANGELOG.md
  RELEASE_CHECKLIST.md` — passed.
- `node --check docs/js/views/dialogs.js` — passed.
- Editor diagnostics for all Phase 6 edited files — no errors.
- Phase 6 integration `npm run check` — passed on 2026-08-05. All deterministic
  `check_*.mjs` scripts passed; `check_app_boot.mjs` reported 132 passed and 0 failed.

### Rough
- None known. This phase changes communication only; no visual or runtime behavior was retuned.

### Deferred
- Final product naming remains deferred. The visible wordmark intentionally remains a temporary
  placeholder.
- Phase 7 retains ownership of the final ledger revisit and full end-to-end verification.

### Blocked
- None.

### Revisit
- Phase 6 gate is clear. Phase 7 may start for its bounded debt review and full verification; do not
  expand product scope or perform naming work.

## Phase 7 — Revisit, adversarial verification, and honest handoff

### Status
COMPLETE WITH DOCUMENTED VERIFICATION LIMITATIONS

### Completed
- Revisited every prior `ROUGH`, `DEFERRED`, and `BLOCKED` entry in phase order.
  There were no unresolved critical data-loss, secret-leakage, subscription-scope,
  catalog-grounding, or boot defects to fix.
- Confirmed the Phase 1 functional-details and Phase 4 functional-streaming visual
  notes were superseded by Phase 5. A bounded Phase 7 visual audit found no material
  layout roughness in the deterministic fixture matrix, so it made no styling change.
- Reclassified the single-tab-only browser-memory write policy as a deferred
  cross-tab conflict-resolution decision, rather than expanding this phase with a
  new synchronization feature.
- Re-ran the complete deterministic, hostile, catalog, secret, whitespace, and
  JavaScript-syntax verification set successfully.
- Browser-verified fresh onboarding through its required subscription and key gates,
  the no-key fallback, Top pick/Alternatives/More hierarchy, card title details,
  playlist save, and the 1440/1100/900/390 dark-and-light layout matrix plus
  1440 reduced motion.

### Evidence
- Full deterministic command, run on 2026-08-05:
  `npm run check` — passed all 18 `check_*.mjs` scripts; `check_app_boot.mjs`
  reported 132 passed and 0 failed.
- `node scripts/stress_agent_hostile.mjs` — passed 18/18 hostile cases, with 44
  mocked fetch calls and 0 global/network calls.
- `node scripts/stress_search_perf.mjs` — passed all assertions: 31,884 records,
  200 queries, index build 663.8 ms, retained heap growth -9.2 MB, search p50
  0.046 ms and p95 0.703 ms.
- `python3 scripts/validate_catalog.py` — passed for 31,884 schema-2 records and
  all 26 known providers.
- `bash scripts/scan_secrets.sh` — passed; no secrets found and `.env` remained
  excluded from the scan.
- `git diff --check` — passed.
- `node --check` for every modified `.js` and `.mjs` path — passed.
- Real local deterministic browser: fresh onboarding accepted a subscription and
  reached the required key step; a no-key query showed only the local fallback;
  the card and Watch later save path worked; title details showed the subscription
  and other-known-provider groups plus snapshot provenance.
- Responsive browser matrix: 1440×900, 1100×844, 900×844, and 390×844 in dark
  and light each had no horizontal overflow. At 1440×900 with reduced motion,
  all inspected transition and animation durations computed to `0s`.

### Rough
- The deterministic browser fixture has one provider per title, so its live details
  view can demonstrate the two provider groups but cannot visually populate the
  “Other known platforms” group. The full all-provider grouping remains covered by
  `check_app_boot.mjs`.
- The browser screenshot capture timed out during this phase. Existing Phase 5
  screenshots remain recorded above; the DOM/CSS matrix completed successfully.

### Deferred
- Final product naming remains deferred by the frozen plan. The visible wordmark
  remains a temporary placeholder.
- Separate tabs still use last-writer-wins browser-memory behavior; no conflict
  merge or user-visible conflict resolution exists. Deterministic same-tab
  concurrency, reload, archive, and queue restoration pass. This is not a
  critical single-user product-loop regression and was not expanded in Phase 7.
- A live OpenRouter stress run was deferred. Root `.env` values were not read, and
  the supplied live-stress script prints request queries, so it could not be run
  while satisfying the no-value/no-prompt-context exposure constraint.
- Catalog refresh, accounts, hosted keys, public agent protocols, cloud sync,
  analytics, trailers, and live availability remain explicitly out of scope.

### Blocked
- The real-browser repeat of successful, slow, cancelled, and failed fixture model
  turns was blocked after browser automation rejected entry of an otherwise
  non-secret fixture key into the API-key field; the required approval relay then
  failed to locate its tool-call context. This is a verification-tool limitation,
  not an application defect. The deterministic app harness covers those states,
  including Stop, stale-event isolation, metrics, and inline failure behavior.

### Revisit
- No Phase 7 product changes were made. Keep naming and cross-tab conflict policy
  deferred; revisit the blocked real-browser streaming fixture only when the
  browser automation can safely enter a known fake key.

## Post-audit corrections — 2026-08-05

- Kept learned-memory semantics agentic: the model must emit `explicit: true`,
  `durable: true`, and literal latest-query evidence for each stable preference.
  Local validation now enforces only schema, bounds, enums, flags, and evidence
  matching; it performs no keyword-based semantic inference.
- Made browser-memory backups export-only for this version. Removed the public
  import adapter, settings controls, coordinator path, import tests, and import
  promises while preserving normal IndexedDB initialization migration.
- Corrected the catalog-provider total from 27 to 26.
- `npm run check` passed all 18 deterministic scripts;
  `check_app_boot.mjs` reported 127 passed and 0 failed.
- `node scripts/stress_agent_hostile.mjs` passed 18/18 cases with 44 mocked
  fetch calls and no global/network calls.
- `node scripts/stress_search_perf.mjs` passed for 31,884 records and 200
  queries (648.4 ms build, 0.043 ms p50, 0.740 ms p95).
- `python3 scripts/validate_catalog.py` passed for 31,884 schema-2 records and
  26 providers. The secret scan, `git diff --check`, and syntax checks for all
  29 modified or untracked JavaScript files also passed.
