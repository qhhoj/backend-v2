#!/usr/bin/env bash
# prepush.sh [base]: the fast local version of the PR checks, before `git push` (npm run prepush). Needs `npm ci`.
# Checks what the branch changed since <base> (default origin/main): a changeset is present, eslint (with prettier) on
# the changed TypeScript files, and openapi.json matches the code when API or lib files changed. It does not run
# typecheck, build or any spec: CI does, and `npm run typecheck` is the next cheapest check.
set -euo pipefail
cd "$(dirname "$0")/../.."
base="${1:-origin/main}"
git rev-parse --verify -q "$base^{commit}" >/dev/null || { echo "unknown base $base: git fetch origin" >&2; exit 2; }
changed="$(git diff --name-only --diff-filter=d "$base"...HEAD; git diff --name-only --diff-filter=d HEAD)"
changed="$(sort -u <<<"$changed" | sed '/^$/d')"

echo "== changeset"
if ! git diff --name-only --diff-filter=A "$base"...HEAD -- '.changeset/*.md' | grep -qv '^.changeset/README.md$'; then
  echo "no changeset: run npm run changeset (an empty one, ---/---, is fine for CI-only changes)" >&2
  exit 1
fi

echo "== eslint and prettier on changed files"
mapfile -t ts_files < <(grep -E '^(apps|libs)/.*[.]ts$' <<<"$changed" || true)
if [ "${#ts_files[@]}" -gt 0 ]; then npx eslint --no-warn-ignored "${ts_files[@]}"; else echo "none"; fi

echo "== openapi.json"
if grep -qE '^(apps/api/|libs/)' <<<"$changed"; then
  out="$(mktemp)"; trap 'rm -f "$out"' EXIT
  OPENAPI_OUT="$out" npm run --silent openapi:emit
  cmp -s "$out" openapi.json || { echo "openapi.json is stale: run npm run openapi:emit and commit it" >&2; exit 1; }
else echo "no API or lib change"; fi
echo "prepush ok"
