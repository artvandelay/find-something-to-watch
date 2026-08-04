# Changelog

All notable changes to this project will be documented here.

## [0.1.0] - Unreleased

### Added

- Static India OTT search across 26 curated providers.
- Schema-2 TMDB + legacy catalog union with 31,884 deduplicated titles.
- Language, genre, provider, year, runtime, kind, and TMDB rating filters.
- Lazy-loaded synopsis sidecar and vote-weighted BM25 ranking.
- Markdown, JSON, CSV, and You.md exports.
- Offline hostile-input, catalog-integrity, and search-performance stress suites.
- Live OpenRouter agent stress harness.

### Changed

- Ratings now use TMDB audience scores.
- Posters are shipped for titles with at least 10 TMDB votes; other titles use initials fallbacks.
- Provider labels, accessibility contrast, focus states, and loading states were updated.

### Verification

- Catalog and synopsis validators pass.
- All six module checks pass.
- Data-integrity and performance suites pass.
- Hostile agent suite passes 12/12 cases without network access.
- Live OpenRouter suite passed 24/24 release-candidate queries.
- Eager catalog payload is under 2 MB gzipped.
