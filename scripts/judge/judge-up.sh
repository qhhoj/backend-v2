#!/usr/bin/env bash
# Starts a real DMOJ judge (podman) connected to the bridge.
# Registers the judge in the backend (admin API), mounts PROBLEM_DATA_ROOT, records the container id.
# Env: PROBLEM_DATA_ROOT (required), API_ORIGIN, SITE_ORIGIN, ADMIN_USERNAME, ADMIN_PASSWORD,
#      BRIDGE_HOST, BRIDGE_PORT, JUDGE_NAME, JUDGE_IMAGE, JUDGE_RUN_DIR.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
: "${PROBLEM_DATA_ROOT:?set PROBLEM_DATA_ROOT to the directory the backend writes problem data to}"
API_ORIGIN="${API_ORIGIN:-http://127.0.0.1:3110}"
SITE_ORIGIN="${SITE_ORIGIN:-${SITE_URL:-$API_ORIGIN}}"
ADMIN_USERNAME="${ADMIN_USERNAME:-e2e_admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-e2e-admin-pass-1}"
BRIDGE_HOST="${BRIDGE_HOST:-127.0.0.1}"
BRIDGE_PORT="${BRIDGE_PORT:-9990}"
JUDGE_NAME="${JUDGE_NAME:-local-judge}"
JUDGE_IMAGE="${JUDGE_IMAGE:-localhost/qhhoj-judge:local}"
JUDGE_RUN_DIR="${JUDGE_RUN_DIR:-/tmp/qhhoj-judge-$(id -u)}"
cidfile="$JUDGE_RUN_DIR/judge.cid"

mkdir -p "$JUDGE_RUN_DIR"
if [ -s "$cidfile" ] && podman container exists "$(cat "$cidfile")"; then
  echo "judge already running ($(cat "$cidfile")); run judge-down.sh first" >&2
  exit 1
fi
rm -f "$cidfile"

if ! podman image exists "$JUDGE_IMAGE"; then
  podman build -t "$JUDGE_IMAGE" -f "$here/Containerfile" "$here"
fi

# The Origin header must equal the backend SITE_URL (cookie requests are origin-checked).
jar="$JUDGE_RUN_DIR/cookies.txt"
csrf=""
api() { curl -sS -H "Origin: $SITE_ORIGIN" -H 'Content-Type: application/json' -H "X-CSRF-Token: $csrf" -b "$jar" -c "$jar" "$@"; }
login="$(api -f -X POST "$API_ORIGIN/api/internal/auth/login" \
  -d "{\"username\":\"$ADMIN_USERNAME\",\"password\":\"$ADMIN_PASSWORD\"}")"
csrf="$(printf '%s' "$login" | sed -n 's/.*"csrfToken":"\([^"]*\)".*/\1/p')"

# Keys are shown once, so a judge that already exists gets a new key (this drops a connected judge).
created="$(api -X POST "$API_ORIGIN/api/internal/judges" -d "{\"name\":\"$JUDGE_NAME\"}" -w '\n%{http_code}')"
if [ "${created##*$'\n'}" != 201 ]; then
  created="$(api -f -X POST "$API_ORIGIN/api/internal/judges/$JUDGE_NAME/key" -d "{}" -w '\n200')"
fi
key="$(printf '%s' "${created%$'\n'*}" | sed -n 's/.*"authKey":"\([^"]*\)".*/\1/p')"
[ -n "$key" ] || { echo "could not obtain a judge key: $created" >&2; exit 1; }

cat > "$JUDGE_RUN_DIR/judge.yml" <<YML
problem_storage_globs:
  - /problems/*
YML

podman run -d --name "qhhoj-judge-$$" --cidfile "$cidfile" \
  --network host --cap-add SYS_PTRACE --security-opt seccomp=unconfined \
  -v "$PROBLEM_DATA_ROOT:/problems:ro" \
  -v "$JUDGE_RUN_DIR/judge.yml:/judge/judge.yml:ro" \
  "$JUDGE_IMAGE" sh -c 'cp /judge/judge.yml /tmp/judge.yml && dmoj-autoconf -s >> /tmp/judge.yml \
    && exec dmoj -c /tmp/judge.yml --no-watchdog --skip-self-test "$@"' sh \
  -p "$BRIDGE_PORT" -- "$BRIDGE_HOST" "$JUDGE_NAME" "$key" >/dev/null
echo "judge '$JUDGE_NAME' started: container $(cat "$cidfile") -> $BRIDGE_HOST:$BRIDGE_PORT"
