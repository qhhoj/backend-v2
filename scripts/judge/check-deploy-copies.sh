#!/usr/bin/env bash
# scripts/judge/check-deploy-copies.sh [JUDGE_V2_DIR]: deploy/judge copies must equal judge-v2/packaging
# (config files: a header line excepted; check-host.sh: byte for byte, its shebang must stay line 1). CI runs it against
# the judge-v2 ref in deploy/judge/judge-release (a release tag, or a main commit SHA while the copies run ahead of the
# latest release): move it with every copy.
set -euo pipefail
backend="$(cd "$(dirname "$0")/../.." && pwd)"
judge="${1:-$backend/../judge-v2}"
[ -d "$judge/packaging" ] || { echo "judge-v2 not found at $judge" >&2; exit 2; }
status=0
if ! diff -u "$judge/packaging/check-host.sh" "$backend/deploy/judge/check-host.sh"; then
  echo "deploy/judge/check-host.sh differs from judge-v2/packaging/check-host.sh" >&2
  status=1
fi
for name in qhhoj-judge.service config.example.toml nftables-judge.conf; do
  if ! diff -u <(cat "$judge/packaging/$name") <(tail -n +2 "$backend/deploy/judge/$name"); then
    echo "deploy/judge/$name differs from judge-v2/packaging/$name" >&2
    status=1
  fi
done
exit "$status"
