#!/usr/bin/env bash
# code-changed.sh <base sha>: prints code=true|false for $GITHUB_OUTPUT. false only when every file changed since
# <base> matches CI_LIGHT_PATHS and none matches CI_HEAVY_PATHS (both ERE). The heavy CI jobs are then skipped,
# and a skipped job still counts as a pass, so the deploy gate sees a green run. Unknown base: true.
set -euo pipefail
base="${1:-}"
light="${CI_LIGHT_PATHS:?CI_LIGHT_PATHS}"
heavy="${CI_HEAVY_PATHS:-}"
if [ -z "$base" ] || [[ $base =~ ^0+$ ]] || ! git cat-file -e "$base^{commit}" 2>/dev/null; then
  echo code=true; exit 0
fi
changed="$(git diff --name-only "$base" HEAD)"
if [ -z "$changed" ] || grep -qvE "$light" <<<"$changed" || { [ -n "$heavy" ] && grep -qE "$heavy" <<<"$changed"; }; then
  echo code=true
else
  echo code=false
fi
