#!/usr/bin/env bash
# deploy/qhhoj-deploy.test.sh: qhhoj-deploy against a fake root with stub podman/systemctl/curl/mongosh.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(mktemp -d)"; bin="$(mktemp -d)"; trap 'rm -rf "$root" "$bin"' EXIT
calls="$root/calls"

stub() { printf '#!/usr/bin/env bash\necho "%s $*" >> "%s"\n%s\n' "$1" "$calls" "${2:-}" > "$bin/$1"; chmod +x "$bin/$1"; }
fresh() {
  rm -rf "${root:?}"/*
  mkdir -p "$root/run" "$root/etc/qhhoj" "$root/var/lib/qhhoj-deploy/incoming" "$root/var/www/qhhoj/releases"
  printf 'MONGO_URL=mongodb://x\nPORT=3000\nSITE_URL=https://oj.test\n' > "$root/etc/qhhoj/env"
  : > "$calls"
  stub podman; stub systemctl; stub sleep
  # shellcheck disable=SC2016 # stub bodies are written to files, expanded when the stub runs
  stub mongosh '[ -n "${STUB_CONTEST:-}" ] && echo "$STUB_CONTEST"; true'
  # shellcheck disable=SC2016
  stub curl '[ "${STUB_HEALTH:-ok}" = ok ]'
}
deploy() { PATH="$bin:$PATH" QHHOJ_DEPLOY_ROOT="$root" QHHOJ_DEPLOY_HEALTH_TRIES=2 bash "$here/qhhoj-deploy" "$@"; }
hist() { cat "$root/var/lib/qhhoj-deploy/backend.history" 2>/dev/null; }
fail() { echo "FAIL: $*" >&2; cat "$calls" >&2; exit 1; }

fresh; deploy backend v2.1.0 >/dev/null || fail "first deploy"
grep -q "podman tag ghcr.io/qhhoj/backend-v2:v2.1.0 ghcr.io/qhhoj/backend-v2:current" "$calls" || fail "tag current"
grep -q "systemctl restart qhhoj.target" "$calls" || fail "restart"
[ "$(hist)" = v2.1.0 ] || fail "history after first deploy"

set +e; deploy backend latest >/dev/null 2>&1; code=$?; set -e
[ "$code" = 64 ] || fail "bad tag must exit 64, got $code"

: > "$calls"; set +e; STUB_CONTEST="r42 2026-10-10T12:00:00.000Z" deploy backend v2.2.0 >/dev/null; code=$?; set -e
[ "$code" = 75 ] || fail "running contest must defer (75), got $code"
grep -q "systemctl restart" "$calls" && fail "deferred deploy restarted"
STUB_CONTEST="r42 2026-10-10T12:00:00.000Z" deploy backend v2.2.0 --force >/dev/null || fail "--force overrides the contest guard"
[ "$(hist | tail -1)" = v2.2.0 ] || fail "forced deploy recorded"

exec 8>"$root/run/qhhoj-migrate.lock"; flock 8
: > "$calls"; set +e; deploy backend v2.3.0 --force >/dev/null; code=$?; set -e
exec 8>&-
[ "$code" = 75 ] || fail "migration lock must defer even with --force, got $code"
grep -q "systemctl restart" "$calls" && fail "deploy restarted during migration"

: > "$calls"; set +e; STUB_HEALTH=fail deploy backend v2.3.0 >/dev/null 2>&1; code=$?; set -e
[ "$code" = 1 ] || fail "failed health must exit 1"
grep -q "podman tag ghcr.io/qhhoj/backend-v2:v2.2.0 ghcr.io/qhhoj/backend-v2:current" "$calls" || fail "rollback to v2.2.0"
[ "$(hist | tail -1)" = v2.2.0 ] || fail "failed deploy must not be recorded"

fresh; set +e; STUB_HEALTH=fail deploy backend v2.1.0 >/dev/null 2>&1; code=$?; set -e
[ "$code" = 1 ] || fail "first deploy failing must exit 1 without a previous version"

fresh; deploy backend v2.1.0 >/dev/null; deploy backend v2.2.0 >/dev/null; : > "$calls"
deploy rollback backend >/dev/null || fail "rollback"
grep -q "podman tag ghcr.io/qhhoj/backend-v2:v2.1.0 ghcr.io/qhhoj/backend-v2:current" "$calls" || fail "rollback target"
[ "$(hist)" = v2.1.0 ] || fail "rollback drops the last entry"
set +e; deploy rollback backend >/dev/null 2>&1; code=$?; set -e
[ "$code" = 1 ] || fail "rollback with one entry must refuse"

status_out="$(deploy status)"
grep -q "backend: v2.1.0" <<<"$status_out" || fail "status"
echo "qhhoj-deploy backend ok"
