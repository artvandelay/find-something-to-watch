# v0.1.0 release checklist

## Required before tagging

- [ ] Rotate the TMDB token that appeared in local debugging output.
- [ ] Confirm redistribution rights for the legacy uNoGS and Streaming Availability records retained in the union.
- [ ] Run `bash scripts/scan_secrets.sh`.
- [ ] Run both catalog validator forms.
- [ ] Run `npm install --ignore-scripts` and `npm run check`.
- [ ] Confirm catalog execution and catalog runtime unit checks pass, including request timeout, Worker
      restart, duplicate-finish suppression, observed-ID grounding, and output limits.
- [ ] Run `node scripts/stress_agent_hostile.mjs` and `node scripts/stress_search_perf.mjs`.
- [ ] Start `node scripts/e2e_catalog_server.mjs` and complete the deterministic browser mock pass with
      a real Worker: normal `run_catalog_js`, subscription-scoped queue, timeout recovery, desktop and
      mobile layouts, and no uncaught console errors.
- [ ] Confirm first-visit onboarding, playlists, backup import, and no-key keyword fallback work while
      the catalog Worker is unavailable.
- [ ] Run exactly one `node scripts/stress_agent_live.mjs --limit 1` query with a release-testing
      OpenRouter key in the root `.env`; do not print, record, or place that key in browser automation.
- [ ] Verify Settings web search is off by default, available only for the exact `openrouter.ai`
      hostname, and discloses that it can add cost. Confirm it is not present in onboarding.
- [ ] Confirm the disposable executor is documented as fault containment, not a hostile-code security
      sandbox.
- [ ] Confirm `gzip -c docs/assets/catalog.json | wc -c` is below 2,000,000 bytes.
- [ ] On a fresh production-like origin, verify the required three-panel onboarding flow: subscriptions,
  nonempty OpenRouter key, then optional CSV/JSON/ZIP history. Confirm no base URL, model, or You.md
  input is present in onboarding.
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

## Publish

- [ ] Replace `Unreleased` in `CHANGELOG.md` with the release date.
- [ ] Tag the reviewed commit as `v0.1.0`.
- [ ] Publish the GitHub release using the changelog entry.
- [ ] Deploy `docs/` and verify the public URL.
