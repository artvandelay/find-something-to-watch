# Changelog

All notable changes to this project will be documented here.

## [0.1.0] - Unreleased

### Added

- Static India OTT search across 26 curated providers.
- Schema-2 TMDB + legacy catalog union with 31,884 deduplicated titles.
- Language, genre, provider, year, runtime, kind, and TMDB rating filters.
- Lazy-loaded synopsis sidecar and vote-weighted BM25 ranking.
- Required three-step onboarding for subscriptions, an OpenRouter key, and optional CSV/JSON/ZIP watch
  history.
- Provider-agnostic local history import with bounded, model-assisted schema inference; complete uploads
  stay in the browser.
- Persistent named playlists, including immutable Watch later, with Markdown, JSON, and CSV exports.
- Synopsis-rich recommendation cards and safe lightweight Markdown assistant replies.
- Browser-local persistence for profile, conversation, queue, You.md, history, and playlists.
- Offline hostile-input, catalog-integrity, and search-performance stress suites.
- Live OpenRouter agent stress harness.

### Changed

- Ratings now use TMDB audience scores.
- Posters are shipped for titles with at least 10 TMDB votes; other titles use initials fallbacks.
- Provider labels, accessibility contrast, focus states, and loading states were updated.
- The visible composer is now natural-language-only; provider, language, genre, and mood intent remain
  available to the agent's subscription-gated catalog tools.

### Verification

- Catalog and synopsis validators pass.
- The npm module-check suite passes.
- Data-integrity and performance suites pass.
- Hostile agent suite passes 12/12 cases without network access.
- Live OpenRouter suite passed 24/24 release-candidate queries.
- Eager catalog payload is under 2 MB gzipped.
