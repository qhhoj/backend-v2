#!/usr/bin/env bash
# Starts judge-v2 (qhhoj-judge) against a `STACK_JUDGE=none npm run stack:up` stack: loopback, no TLS,
# the seeded judge e2e-judge, PROBLEM_DATA_ROOT read directly, hold gates in FULLSTACK_CONTROL_DIR (J7).
# Stopped by `npm run stack:down` (recorded in $RUN/pids).
# Env: RUN, JUDGE_V2_DIR (../judge-v2), JUDGE_V2_BIN (skip the build), JUDGE_BOX_BASE (960), JUDGE_METRICS_PORT (9465).
set -euo pipefail
BACKEND="$(cd "$(dirname "$0")/../.." && pwd)"
source "$BACKEND/scripts/fullstack/lib.sh"
[ -s "$RUN/env" ] || { echo "no stack at $RUN: run STACK_JUDGE=none npm run stack:up first" >&2; exit 1; }
set -a; source "$RUN/env"; set +a
if grep -q '^judge ' "$PIDS" 2>/dev/null; then echo "a judge is already recorded in $PIDS (fake or v2); use a stack started with STACK_JUDGE=none" >&2; exit 1; fi
command -v isolate >/dev/null || { echo "isolate is not installed (see judge-v2 README)" >&2; exit 1; }

JUDGE_V2_DIR="$(cd "${JUDGE_V2_DIR:-$BACKEND/../judge-v2}" && pwd)"
if [ -z "${JUDGE_V2_BIN:-}" ]; then
  (cd "$JUDGE_V2_DIR" && capped 4G cargo build -j2 -p judge-cli)
  JUDGE_V2_BIN="$JUDGE_V2_DIR/target/debug/qhhoj-judge"
fi

dir="$RUN/judge-v2"
mkdir -p "$dir/cache" "$FULLSTACK_CONTROL_DIR"
(umask 077 && printf '%s\n' "$FAKE_JUDGE_KEY" > "$dir/key")
cat > "$dir/config.toml" <<TOML
name = "${FAKE_JUDGE_NAME:-e2e-judge}"
bridge_url = "http://127.0.0.1:$JUDGE_BRIDGE_PORT"
key_file = "$dir/key"
problem_data_root = "$PROBLEM_DATA_ROOT"
cache_dir = "$dir/cache"
cache_max_bytes = 2147483648
languages_file = "$JUDGE_V2_DIR/languages.toml"
testlib_dir = "$JUDGE_V2_DIR/assets/testlib"
metrics_listen = "127.0.0.1:${JUDGE_METRICS_PORT:-9465}"
slots = 2
box_base = ${JUDGE_BOX_BASE:-960}
drain_timeout_s = 5
control_dir = "$FULLSTACK_CONTROL_DIR"
TOML

start judge "$RUN/judge.log" "$JUDGE_V2_BIN" --config "$dir/config.toml"
wait_for "judge-v2 bridge session" grep -q "bridge session started" "$RUN/judge.log"
echo "judge-v2 online as ${FAKE_JUDGE_NAME:-e2e-judge} (log $RUN/judge.log, metrics 127.0.0.1:${JUDGE_METRICS_PORT:-9465})"
