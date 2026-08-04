# v0.1.0 release checklist

## Required before tagging

- [ ] Rotate the TMDB token that appeared in local debugging output.
- [ ] Confirm redistribution rights for the legacy uNoGS and Streaming Availability records retained in the union.
- [ ] Run `bash scripts/scan_secrets.sh`.
- [ ] Run both catalog validator forms.
- [ ] Run all six `scripts/check_*.mjs` checks.
- [ ] Run the three offline stress suites.
- [ ] Run `node scripts/stress_agent_live.mjs` with a release-testing OpenRouter key.
- [ ] Smoke-test the final catalog in a browser with no console errors.
- [ ] Confirm `gzip -c docs/assets/catalog.json | wc -c` is below 2,000,000 bytes.

## Publish

- [ ] Replace `Unreleased` in `CHANGELOG.md` with the release date.
- [ ] Tag the reviewed commit as `v0.1.0`.
- [ ] Publish the GitHub release using the changelog entry.
- [ ] Deploy `docs/` and verify the public URL.
