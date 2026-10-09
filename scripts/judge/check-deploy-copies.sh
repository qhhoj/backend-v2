#!/usr/bin/env bash
# scripts/judge/check-deploy-copies.sh [JUDGE_V2_DIR]: deploy/judge copies must equal judge-v2/packaging (header line excepted).
set -euo pipefail
backend="$(cd "$(dirname "$0")/../.." && pwd)"
judge="${1:-$backend/../judge-v2}"
[ -d "$judge/packaging" ] || { echo "judge-v2 not found at $judge" >&2; exit 2; }
status=0
for name in qhhoj-judge.service config.example.toml; do
  if ! diff -u <(cat "$judge/packaging/$name") <(tail -n +2 "$backend/deploy/judge/$name"); then
    echo "deploy/judge/$name differs from judge-v2/packaging/$name" >&2
    status=1
  fi
done
exit "$status"
