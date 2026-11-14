#!/usr/bin/env bash
# version-only.sh <from> <to>: exit 0 only when <from>..<to> is a version-packages change: files only under .changeset/,
# CHANGELOG.md, package.json and package-lock.json, and the two JSON files equal apart from their version fields
# (package.json "version", package-lock.json "version" and packages[""].version). Anything else exits 1.
set -euo pipefail
from="${1:?from}" to="${2:?to}"
VERSION_ONLY_PATHS='^(\.changeset/.*|CHANGELOG\.md|package\.json|package-lock\.json)$'
changed="$(git diff --no-renames --name-only "$from" "$to")"
[ -n "$changed" ] && ! grep -qvE "$VERSION_ONLY_PATHS" <<<"$changed" || exit 1
unversioned() { # <rev> <file>: the JSON file without its version fields
  git show "$1:$2" | jq -S 'del(.version) | if .packages then del(.packages[""].version) else . end'
}
for file in package.json package-lock.json; do
  git diff --no-renames --quiet "$from" "$to" -- "$file" && continue
  [ "$(unversioned "$from" "$file")" = "$(unversioned "$to" "$file")" ] || exit 1
done
