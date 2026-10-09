#!/usr/bin/env bash
# Temporary local-only dev/test judge (see judge-up.sh). Stops the judge container recorded by judge-up.sh (by container id, never by name).
set -euo pipefail
JUDGE_RUN_DIR="${JUDGE_RUN_DIR:-/tmp/qhhoj-judge-$(id -u)}"
cidfile="$JUDGE_RUN_DIR/judge.cid"
[ -s "$cidfile" ] || { echo "no judge recorded in $cidfile"; exit 0; }
cid="$(cat "$cidfile")"
podman rm -f -t 5 "$cid" >/dev/null 2>&1 || true
rm -f "$cidfile" "$JUDGE_RUN_DIR/cookies.txt"
echo "judge $cid stopped"
