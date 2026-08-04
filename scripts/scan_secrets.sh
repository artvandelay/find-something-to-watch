#!/usr/bin/env bash
# scan_secrets.sh — scan the repo for likely committed secrets.
#
# Scans tracked source files (plus untracked files that are not gitignored)
# for common key shapes:
#   - sk-<20+ chars>                    (OpenAI/OpenRouter-style tokens)
#   - eyJ<10+ chars>.                   (JWTs / bearer tokens, incl. TMDB v4)
#   - api_key=<20+ chars>               (TMDB v3-style query params)
#   - x-rapidapi-key: "<20+ chars>"     (RapidAPI key headers)
#   - api[-_]key = "<20+ chars>"        (generic key assignments)
#
# Excluded from the scan: .git/, data/, catalog/*.db, catalog/*.log,
# node_modules/, docs/assets/catalog*.json, and .env itself.
#
# Exit 0 and print "no secrets found" when clean; exit 1 listing file:line
# for every hit otherwise.

set -euo pipefail

cd "$(dirname "$0")/.."

# .env holds the real keys. It is gitignored and must never be scanned or
# committed — confirm that and say so.
if grep -qxF '.env' .gitignore; then
  echo "OK: .env is listed in .gitignore; it is excluded from this scan."
else
  echo "FAIL: .env is NOT listed in .gitignore — fix that before committing." >&2
  exit 1
fi

files=$(git ls-files --cached --others --exclude-standard \
  | grep -vE '^\.git/|^data/|^catalog/.*\.db(-journal)?$|^catalog/.*\.log$|^node_modules/|^docs/assets/catalog[^/]*\.json$|^\.env$' \
  || true)

if [ -z "$files" ]; then
  echo "no secrets found"
  exit 0
fi

hits=$(mktemp)
trap 'rm -f "$hits"' EXIT

# $1 = label, $2 = pattern, $3 = "-i" for case-insensitive or "" for sensitive.
# grep exits 1 when nothing matches; that is the happy path, not an error.
# A plain loop is used instead of xargs so the scan also works in restricted
# sandboxes where xargs' sysconf(_SC_ARG_MAX) probe fails.
scan() {
  local label="$1" pattern="$2" flag="${3:-}" file ln n
  while IFS= read -r file; do
    [ -f "$file" ] || continue
    if [ -n "$flag" ]; then
      ln=$(grep -nEIi "$pattern" "$file" 2>/dev/null | cut -d: -f1 || true)
    else
      ln=$(grep -nEI "$pattern" "$file" 2>/dev/null | cut -d: -f1 || true)
    fi
    # Only file:line is reported, never the matched content.
    if [ -n "$ln" ]; then
      while IFS= read -r n; do
        printf '[%s] %s:%s\n' "$label" "$file" "$n" >> "$hits"
      done <<< "$ln"
    fi
  done <<< "$files"
  return 0
}

# Case-sensitive: real tokens have fixed lowercase prefixes, and sensitivity
# keeps CDN signatures (e.g. "...Sk-60zL...") from false-positiving.
scan "api-token"       'sk-[A-Za-z0-9]{20,}'
scan "jwt"             'eyJ[A-Za-z0-9_-]{10,}\.'
scan "tmdb-v3-key"     'api_key=[A-Za-z0-9]{20,}'

# Case-insensitive: header and variable names vary in casing.
scan "rapidapi-key"    "x-rapidapi-key[\"']?[[:space:]]*[:=][[:space:]]*[\"'][A-Za-z0-9]{20,}"       -i
scan "generic-api-key" "api[_-]?key[\"']?[[:space:]]*[:=][[:space:]]*[\"'][A-Za-z0-9_-]{20,}[\"']"   -i

if [ -s "$hits" ]; then
  echo "potential secrets found (file:line):" >&2
  sort -u "$hits" >&2
  exit 1
fi

echo "no secrets found"
exit 0
