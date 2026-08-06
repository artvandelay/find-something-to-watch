# v0.1.0 release checklist

## Required before tagging

- [ ] Confirm **Find Something to Watch** is used consistently in release copy and repository links.
- [ ] Rotate the TMDB token that appeared in local debugging output.
- [ ] Run `bash scripts/scan_secrets.sh`.
- [ ] Run both catalog validator forms.
- [ ] Run `npm install --ignore-scripts` and `npm run check`.
- [ ] Confirm catalog execution and catalog runtime unit checks pass, including request timeout, Worker
      restart, duplicate-finish suppression, observed-ID grounding, and output limits.
- [ ] Run `node scripts/stress_agent_hostile.mjs` and `node scripts/stress_search_perf.mjs`.
- [ ] Start `node scripts/e2e_catalog_server.mjs` and complete the deterministic browser mock pass with
      a real Worker: normal `run_catalog_js`, subscription-scoped queue, timeout recovery, desktop and
      mobile layouts, and no uncaught console errors.
- [ ] Confirm direct first-visit workspace access, the no-key chat gate, playlists, and backup export
      work while the catalog Worker is unavailable.
- [ ] Run exactly one `node scripts/stress_agent_live.mjs --limit 1` query with a release-testing
      OpenRouter key in the root `.env`; do not print, record, or place that key in browser automation.
- [ ] Verify Settings web search is off by default, available only for the exact `openrouter.ai`
      hostname, and discloses that it can add cost.
- [ ] Confirm the disposable executor is documented as fault containment, not a hostile-code security
      sandbox.
- [ ] Confirm `gzip -c docs/assets/catalog.json | wc -c` is below 2,000,000 bytes.
- [ ] On a fresh production-like origin, verify the shell opens directly, the composer requires an API
  key, and the in-chat guidance sends the visitor to Settings. Configure subscriptions, endpoint, key,
  and model there; import optional CSV/JSON/ZIP history from Profile & context.
- [ ] Import representative CSV, nested JSON, and ZIP history exports. Confirm only bounded filenames,
  structural metadata, and sample rows/records reach the schema-inference request; full uploads remain
  local and a failed import preserves existing history.
- [ ] Verify the natural-language-only composer, safe formatted assistant paragraphs/lists, synopsis
  clamp, and subscription-gated recommendation/provider links. Confirm dated availability and
  search/fallback links are still labelled accurately.
- [ ] Verify Watch later is first and protected; create, rename, delete, save to, restore, and export
  custom playlists. Start a new chat and confirm it does not change playlists.
- [ ] On localhost, verify `?testMode=1` works only for `localhost` or `127.0.0.1`, honors known
  `testProviders`, and never stores a key. Confirm it is ignored on a production host.
- [ ] Verify the maintainer developer console with `Ctrl+Alt+Shift+D` (`Control+Option+Shift+D` on
  macOS): trace, recommendation exports, and catalog provenance work; no API key or model configuration
  is exposed. This shortcut is discoverability-only, not authentication.

## Phase 1–5 UX gates

- [ ] **Phase 1 — catalog details:** Run `node scripts/check_catalog_fidelity.mjs`, `node
      scripts/check_app_boot.mjs`, and `npm run check`. Verify full-record title details resolve on the
      main thread, refresh after sidecar/subscription changes, restore focus, and group providers into
      **On your subscriptions** and **Other known platforms**. Confirm no unavailable source fields are
      invented and availability is described as a dated snapshot.
- [ ] **Phase 2 — decisions and memory:** Run `node scripts/check_recommendations.mjs`, `node
      scripts/check_preferences.mjs`, `node scripts/check_memory.mjs`, and `node
      scripts/check_app_boot.mjs`. Verify reload, New chat archiving, conversation switching, ranked
      queue restoration, backup migration, and learned-memory edit, disable, and clear behavior.
- [ ] **Phase 3 — transport and cancellation:** Run `node scripts/check_llm_client.mjs`, `node
      scripts/check_tools.mjs`, `node scripts/check_catalog_runtime.mjs`, `node
      scripts/check_agent.mjs`, and `node scripts/stress_agent_hostile.mjs`. Confirm a deterministic
      cancellation terminates only the matching disposable executor while the trusted catalog host stays
      available. If a release-testing key is configured, optionally run one live stream without logging
      the key or model context.
- [ ] **Phase 4 — live turn UX:** Run `npm run check` and the deterministic browser fixture. Verify a
      normal, slow, cancelled, and failed turn: user persistence, attached phase order, incremental safe
      Markdown, Top pick/Alternatives/More options, source query, fit reasons, reported-or-unavailable
      cost, Stop, slow state, and stale-event isolation.
- [ ] **Phase 5 — visual system:** In the local deterministic browser fixture, check dark and light at
      1440×900, 1100×844, 900×844, and 390×844, plus reduced motion at 1440. Confirm no horizontal
      overflow, no sidebar/composer seam, sidebar-bottom subscriptions, visible recommendation priority,
      and no glow, pill, or rounded-dashboard residue.

## Publish

- [ ] Replace `Unreleased` in `CHANGELOG.md` with the release date.
- [ ] Tag the reviewed commit as `v0.1.0`.
- [ ] Publish the GitHub release using the changelog entry.
- [ ] Deploy `docs/` and verify the public URL.
