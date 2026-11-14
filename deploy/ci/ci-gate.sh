#!/usr/bin/env bash
# ci-gate.sh <sha> <workflow file> <timeout minutes>: the CI gate of a deploy; exit 0 only when the gated commit's CI passed.
# A version-packages commit changes only .changeset/, CHANGELOG.md and the "version" lines of package.json and
# package-lock.json: no code differs from its parent, so the parent's CI (the run on main before it) is the gate and the
# build need not wait for CI on the version commit itself. Every other commit waits for its own CI run.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
sha="${1:?sha}" workflow="${2:?workflow}" minutes="${3:?timeout minutes}"
VERSION_ONLY_PATHS='^(\.changeset/.*|CHANGELOG\.md|package\.json|package-lock\.json)$'

version_only() { # <sha> <parent>: nothing but the files and the version lines named above changed
  local changed
  changed="$(git diff --name-only "$2" "$1")"
  [ -n "$changed" ] && ! grep -qvE "$VERSION_ONLY_PATHS" <<<"$changed" || return 1
  # package.json / package-lock.json: every changed line is a "version" line (the lockfile keeps one per package entry it bumps)
  ! git diff -U0 "$2" "$1" -- package.json package-lock.json | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)' | grep -vE '^[+-]\s*"version": "[^"]+",?$'
}

parents="$(git rev-list --parents -n 1 "$sha" | wc -w)" # the sha and its parents
if [ "$parents" = 2 ] && version_only "$sha" "$sha^"; then
  gate="$(git rev-parse "$sha^")"
  echo "$sha only versions packages: gating on its parent $gate"
  exec bash "$here/wait-for-ci.sh" "$gate" "$workflow" "$minutes"
fi
exec bash "$here/wait-for-ci.sh" "$sha" "$workflow" "$minutes"
