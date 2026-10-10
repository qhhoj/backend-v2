#!/usr/bin/env bash
# wait-for-ci.sh <sha> <workflow file> <timeout minutes>: waits for that workflow's run on <sha>; exit 0 only on success.
set -euo pipefail
sha="${1:?sha}" workflow="${2:?workflow}" minutes="${3:?timeout minutes}"
interval="${WAIT_INTERVAL:-30}"
deadline=$(( $(date +%s) + minutes * 60 ))
while :; do
  state="$(gh run list --workflow "$workflow" --commit "$sha" --limit 1 --json status,conclusion \
    --jq '.[0] | "\(.status) \(.conclusion)"' 2>/dev/null || true)"
  case "$state" in
    "completed success") echo "$workflow passed on $sha"; exit 0 ;;
    completed*) echo "$workflow did not pass on $sha: $state" >&2; exit 1 ;;
  esac
  [ "$(date +%s)" -lt "$deadline" ] || { echo "timed out waiting for $workflow on $sha (${state:-no run})" >&2; exit 1; }
  sleep "$interval"
done
