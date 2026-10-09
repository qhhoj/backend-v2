#!/usr/bin/env bash
# CI drift check: the vendored proto/ matches proto.lock.json and the committed TypeScript is what it generates.
# With a judge-v2 checkout as $1, also checks the lock against that checkout's tag (run locally; CI has no judge-v2).
set -euo pipefail
BACKEND="$(cd "$(dirname "$0")/../.." && pwd)"
node "$BACKEND/scripts/judge-proto/lock.js" check
fresh="$(mktemp -d)"
trap 'rm -rf "$fresh"' EXIT
bash "$BACKEND/scripts/judge-proto/generate.sh" "$fresh"
if ! diff -r "$fresh" "$BACKEND/libs/judge-proto/src/generated"; then
  echo "libs/judge-proto/src/generated is stale: run bash scripts/judge-proto/generate.sh and commit it" >&2
  exit 1
fi
if [ -n "${1:-}" ]; then node "$BACKEND/scripts/judge-proto/lock.js" upstream "$1"; fi
echo "judge-proto is in sync"
