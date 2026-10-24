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
  mkdir -p "$root/etc/nginx/conf.d"; echo "root /var/www/qhhoj/current;" > "$root/etc/nginx/conf.d/qhhoj.conf"
  : > "$calls"
  # shellcheck disable=SC2016 # stub bodies are expanded when the stub runs
  stub podman '[ "${1:-}" = login ] && { cat > "$QHHOJ_DEPLOY_ROOT/login.stdin"; touch "$3"; }; [ "${1:-}" = image ] && [ "${2:-}" = exists ] && [ -n "${STUB_IMAGE_MISSING:-}" ] && exit 1; [ "${1:-}" = image ] && [ "${2:-}" = ls ] && printf "%s\n" ${STUB_IMAGES:-}; [ "${1:-}" = run ] && [ -n "${STUB_INDEX_FAIL:-}" ] && exit 1; true'
  # shellcheck disable=SC2016
  stub systemctl '[ "$1" = restart ] && [ -e "$QHHOJ_DEPLOY_ROOT/restart_fail" ] && { rm -f "$QHHOJ_DEPLOY_ROOT/restart_fail"; exit 1; }; true'
  stub sleep
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
grep -q "podman run .* ghcr.io/qhhoj/backend-v2:v2.1.0 indexes" "$calls" || fail "index step"
[ "$(grep -n "indexes" "$calls" | cut -d: -f1)" -lt "$(grep -n "systemctl restart" "$calls" | cut -d: -f1)" ] \
  || fail "indexes are built before the restart"
grep -q 'mongodb://x' "$calls" && fail "MONGO_URL (password) must not be a podman argument"

: > "$calls"; set +e; STUB_INDEX_FAIL=1 deploy backend v2.1.1 >/dev/null 2>&1; code=$?; set -e
[ "$code" = 1 ] || fail "failed index build must exit 1, got $code"
grep -q "podman tag\|systemctl restart" "$calls" && fail "failed index build switched the backend"
[ "$(hist)" = v2.1.0 ] || fail "failed index build must not be recorded"

set +e; deploy backend latest >/dev/null 2>&1; code=$?; set -e
[ "$code" = 64 ] || fail "bad tag must exit 64, got $code"

: > "$calls"; set +e; STUB_CONTEST="r42 2026-10-10T12:00:00.000Z" deploy backend v2.2.0 >/dev/null; code=$?; set -e
[ "$code" = 75 ] || fail "running contest must defer (75), got $code"
grep -q 'mongodb://x' "$calls" && fail "MONGO_URL (password) must not be a mongosh argument"
grep -q "systemctl restart" "$calls" && fail "deferred deploy restarted"
STUB_CONTEST="r42 2026-10-10T12:00:00.000Z" deploy backend v2.2.0 --force >/dev/null || fail "--force overrides the contest guard"
[ "$(hist | tail -1)" = v2.2.0 ] || fail "forced deploy recorded"

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
tarball() { # <version> [no-index]
  local src; src="$(mktemp -d)"
  [ "${2:-}" = no-index ] || echo "<html>$1</html>" > "$src/index.html"
  mkdir -p "$src/assets"; echo "js $1" > "$src/assets/app.js"
  local name; for name in ${ASSETS:-}; do echo "chunk $name" > "$src/assets/$name"; done # extra hashed chunks
  tar -czf "$root/var/lib/qhhoj-deploy/incoming/frontend-dist-$1.tar.gz" -C "$src" .
  (cd "$root/var/lib/qhhoj-deploy/incoming" && sha256sum "frontend-dist-$1.tar.gz" > "frontend-dist-$1.tar.gz.sha256")
  rm -rf "$src"
}
www="$root/var/www/qhhoj"
fresh
# shellcheck disable=SC2016 # stub body is expanded when the stub runs
stub curl 'out=""; while [ $# -gt 0 ]; do [ "$1" = -o ] && out=$2; shift; done; [ "${STUB_HEALTH:-ok}" = ok ] && cp "$QHHOJ_DEPLOY_ROOT/var/www/qhhoj/current/index.html" "$out"; [ "${STUB_HEALTH:-ok}" = ok ]'
tarball v2.1.0; deploy frontend v2.1.0 >/dev/null || fail "frontend deploy"
[ "$(readlink "$www/current")" = releases/v2.1.0 ] || fail "current -> v2.1.0"
[ -f "$www/releases/v2.1.0/assets/app.js" ] || fail "unpacked"
[ ! -e "$root/var/lib/qhhoj-deploy/incoming/frontend-dist-v2.1.0.tar.gz" ] || fail "incoming cleaned"

tarball v2.2.0; echo garbage >> "$root/var/lib/qhhoj-deploy/incoming/frontend-dist-v2.2.0.tar.gz"
set +e; deploy frontend v2.2.0 >/dev/null 2>&1; code=$?; set -e
[ "$code" = 1 ] || fail "checksum mismatch must fail"
[ "$(readlink "$www/current")" = releases/v2.1.0 ] || fail "checksum mismatch kept v2.1.0"

tarball v2.3.0 no-index
set +e; deploy frontend v2.3.0 >/dev/null 2>&1; code=$?; set -e
[ "$code" = 1 ] && [ "$(readlink "$www/current")" = releases/v2.1.0 ] || fail "no index.html must fail and keep v2.1.0"

tarball v2.4.0
set +e; STUB_HEALTH=fail deploy frontend v2.4.0 >/dev/null 2>&1; code=$?; set -e
[ "$code" = 1 ] && [ "$(readlink "$www/current")" = releases/v2.1.0 ] || fail "unhealthy frontend must flip back"

tarball v2.5.0; deploy frontend v2.5.0 >/dev/null
deploy rollback frontend >/dev/null || fail "frontend rollback"
[ "$(readlink "$www/current")" = releases/v2.1.0 ] || fail "frontend rollback target"


# --- fix round 1 ---
inc="$root/var/lib/qhhoj-deploy/incoming"
fhist() { cat "$root/var/lib/qhhoj-deploy/frontend.history"; }
# shellcheck disable=SC2016 # stub body is expanded when the stub runs
frontend_curl='out=""; while [ $# -gt 0 ]; do [ "$1" = -o ] && out=$2; shift; done; [ "${STUB_HEALTH:-ok}" = ok ] && cp "$QHHOJ_DEPLOY_ROOT/var/www/qhhoj/current/index.html" "$out"; [ "${STUB_HEALTH:-ok}" = ok ]'
fresh_frontend() { fresh; stub curl "$frontend_curl"; }
refused_frontend() { # <version> <label>: deploy must exit 1, leave current on v2.1.0 and create no release
  local code
  set +e; deploy frontend "$1" >/dev/null 2>&1; code=$?; set -e
  [ "$code" = 1 ] || fail "$2 must exit 1, got $code"
  [ "$(readlink "$www/current")" = releases/v2.1.0 ] || fail "$2 changed current"
  [ ! -e "$www/releases/$1" ] || fail "$2 left a release"
}
tarball_linked() { # <version>: like tarball, plus a symlink member pointing at /etc
  local src; src="$(mktemp -d)"
  echo "<html>$1</html>" > "$src/index.html"; ln -s /etc "$src/leak"
  tar -czf "$inc/frontend-dist-$1.tar.gz" -C "$src" .
  (cd "$inc" && sha256sum "frontend-dist-$1.tar.gz" > "frontend-dist-$1.tar.gz.sha256")
  rm -rf "$src"
}
tarball_escape() { # <version>: archive whose member name climbs out of the release dir
  local src; src="$(mktemp -d)"
  echo "<html>$1</html>" > "$src/index.html"; echo escaped > "$src/x.html"
  tar -czf "$inc/frontend-dist-$1.tar.gz" -C "$src" --transform 's,^x\.html$,../escaped.html,' index.html x.html 2>/dev/null
  (cd "$inc" && sha256sum "frontend-dist-$1.tar.gz" > "frontend-dist-$1.tar.gz.sha256")
  rm -rf "$src"
}

fresh_frontend; tarball v2.1.0; deploy frontend v2.1.0 >/dev/null || fail "round-1 baseline"
tarball_linked v2.6.0; refused_frontend v2.6.0 "symlink member"
tarball_escape v2.9.0; refused_frontend v2.9.0 "parent-directory member"
tarball v2.7.0; real="$(mktemp)"; mv "$inc/frontend-dist-v2.7.0.tar.gz" "$real"
ln -s "$real" "$inc/frontend-dist-v2.7.0.tar.gz"; refused_frontend v2.7.0 "symlinked tarball"; rm -f "$real"
tarball v2.8.0; echo decoy > "$inc/decoy.bin"
echo "$(sha256sum "$inc/decoy.bin" | cut -d' ' -f1)  decoy.bin" > "$inc/frontend-dist-v2.8.0.tar.gz.sha256"
refused_frontend v2.8.0 "decoy checksum"

# a failed restart re-points the backend to the previous tag and is not recorded
fresh; deploy backend v2.1.0 >/dev/null || fail "restart baseline"
: > "$calls"; touch "$root/restart_fail"
set +e; deploy backend v2.2.0 >/dev/null 2>&1; code=$?; set -e
[ "$code" = 1 ] || fail "failed restart must exit 1, got $code"
grep -q "podman tag ghcr.io/qhhoj/backend-v2:v2.1.0 ghcr.io/qhhoj/backend-v2:current" "$calls" || fail "failed restart did not restore v2.1.0"
[ "$(hist)" = v2.1.0 ] || fail "failed restart must not be recorded"

# rollback to a pruned backend image is refused with history unchanged
fresh; deploy backend v2.1.0 >/dev/null; deploy backend v2.2.0 >/dev/null; : > "$calls"
export STUB_IMAGE_MISSING=1
set +e; deploy rollback backend >/dev/null 2>&1; code=$?; set -e
unset STUB_IMAGE_MISSING
[ "$code" = 1 ] || fail "rollback to a pruned image must exit 1, got $code"
[ "$(hist)" = "$(printf 'v2.1.0\nv2.2.0')" ] || fail "pruned-image rollback changed history"
! grep -q "podman tag" "$calls" || fail "pruned-image rollback re-tagged current"

# rollback to a pruned frontend release is refused with history and current unchanged
fresh_frontend; tarball v2.1.0; deploy frontend v2.1.0 >/dev/null
tarball v2.2.0; deploy frontend v2.2.0 >/dev/null; rm -rf "$www/releases/v2.1.0"
set +e; deploy rollback frontend >/dev/null 2>&1; code=$?; set -e
[ "$code" = 1 ] || fail "rollback to a pruned release must exit 1, got $code"
[ "$(fhist)" = "$(printf 'v2.1.0\nv2.2.0')" ] || fail "pruned-release rollback changed history"
[ "$(readlink "$www/current")" = releases/v2.2.0 ] || fail "pruned-release rollback moved current"


# --- task 13: registry token per deploy ---
fresh; deploy backend v2.1.0 >/dev/null </dev/null || fail "default authfile deploy"
grep -q "podman pull --authfile $root/etc/qhhoj/ghcr-auth.json" "$calls" || fail "default pull uses the host authfile"
fresh; printf 'tok-secret\n' | deploy backend v2.1.0 --token-stdin >/dev/null || fail "token-stdin deploy"
[ "$(cat "$root/login.stdin")" = tok-secret ] || fail "token must reach podman login on stdin"
grep -q "podman login --authfile .* --username qhhoj-deploy --password-stdin ghcr.io" "$calls" || fail "podman login arguments"
! grep -q tok-secret "$calls" || fail "token must not appear in any command line"
auth="$(sed -n 's/^podman pull --authfile \([^ ]*\) .*/\1/p' "$calls")"
[ -n "$auth" ] && [ "$auth" != "$root/etc/qhhoj/ghcr-auth.json" ] || fail "pull must use the per-deploy authfile"
[ ! -e "$(dirname "$auth")" ] || fail "per-deploy temp dir must be removed"
fresh; printf 'tok\n' | deploy backend v2.2.0 --token-stdin --force >/dev/null || fail "flags in any order"
set +e; deploy backend v2.1.0 --bogus >/dev/null 2>&1; code=$?; set -e
[ "$code" = 64 ] || fail "unknown flag must exit 64, got $code"
fresh; set +e; printf '\n' | deploy backend v2.1.0 --token-stdin >/dev/null 2>&1; code=$?; set -e
[ "$code" = 1 ] || fail "empty token must exit 1, got $code"
! grep -q "podman pull" "$calls" || fail "empty token must fail before pulling"

# --- final-review fixes ---
# I1: a held deploy lock defers (75) instead of failing
fresh; exec 7>"$root/run/qhhoj-deploy.lock"; flock 7
set +e; out="$(QHHOJ_DEPLOY_LOCK_WAIT=1 deploy backend v2.1.0 2>&1)"; code=$?; set -e
exec 7>&-
[ "$code" = 75 ] || fail "deploy lock timeout must exit 75, got $code"
grep -q "deferred: another deploy holds the lock" <<<"$out" || fail "lock timeout message"

# I2: reset-failed before restart; the restored version is health-checked
fresh; deploy backend v2.1.0 >/dev/null; : > "$calls"; deploy backend v2.2.0 >/dev/null
reset_line="$(grep -n "systemctl reset-failed qhhoj-api qhhoj-bridge qhhoj-worker" "$calls" | head -1 | cut -d: -f1)"
restart_line="$(grep -n "systemctl restart qhhoj.target" "$calls" | head -1 | cut -d: -f1)"
[ -n "$reset_line" ] && [ "$reset_line" -lt "$restart_line" ] || fail "reset-failed must precede restart"
# shellcheck disable=SC2016 # stub body is expanded when the stub runs
counting_curl='n=$(cat "$QHHOJ_DEPLOY_ROOT/n" 2>/dev/null || echo 0); echo $((n+1)) > "$QHHOJ_DEPLOY_ROOT/n"; [ "$n" -ge 2 ]'
fresh; deploy backend v2.1.0 >/dev/null; stub curl "$counting_curl"; rm -f "$root/n"
set +e; out="$(deploy backend v2.2.0 2>&1)"; code=$?; set -e
[ "$code" = 1 ] || fail "failed deploy must exit 1, got $code"
grep -q "previous version v2.1.0 restored and healthy" <<<"$out" || fail "restored-healthy line: $out"
fresh; deploy backend v2.1.0 >/dev/null; : > "$calls"
set +e; out="$(STUB_HEALTH=fail deploy backend v2.2.0 2>&1)"; code=$?; set -e
[ "$code" = 1 ] || fail "unhealthy restore must exit 1, got $code"
grep -q "previous version v2.1.0 restored but UNHEALTHY" <<<"$out" || fail "restored-unhealthy line: $out"
[ "$(grep -c '^curl' "$calls")" = 4 ] || fail "restore must run a second health check"

# I3: without an nginx conf for the v2 root, the frontend check is a file check only
fresh_frontend; tarball v2.1.0
rm -rf "$root/etc/nginx"; : > "$calls"
out="$(STUB_HEALTH=fail deploy frontend v2.1.0 2>&1)" || fail "file check only must pass without nginx serving v2: $out"
grep -q "nginx does not serve v2 yet: file check only" <<<"$out" || fail "file-check message"
! grep -q '^curl' "$calls" || fail "file check must not use HTTP"
mkdir -p "$root/etc/nginx/conf.d"; echo "root /var/www/qhhoj/current;" > "$root/etc/nginx/conf.d/qhhoj.conf"
tarball v2.2.0; : > "$calls"
set +e; STUB_HEALTH=fail deploy frontend v2.2.0 >/dev/null 2>&1; code=$?; set -e
[ "$code" = 1 ] && grep -q '^curl' "$calls" || fail "with the nginx conf the HTTP check applies"

# I5: only a contest ending within 24 h defers
fresh; : > "$calls"
# shellcheck disable=SC2016 # stub body is expanded when the stub runs
stub mongosh 'echo "$*" >> "$QHHOJ_DEPLOY_ROOT/mongosh.args"; true'
deploy backend v2.1.0 >/dev/null
grep -q 'endTime: { $gt: now, $lte: soon }' "$root/mongosh.args" && grep -q '24 \* 60 \* 60 \* 1000' "$root/mongosh.args" || fail "contest guard must bound endTime to 24 h"

# FIFO planted in incoming must be refused without blocking
fresh_frontend; mkfifo "$inc/frontend-dist-v2.1.0.tar.gz"; : > "$inc/frontend-dist-v2.1.0.tar.gz.sha256"
set +e; timeout 10 env PATH="$bin:$PATH" QHHOJ_DEPLOY_ROOT="$root" bash "$here/qhhoj-deploy" frontend v2.1.0 >/dev/null 2>&1; code=$?; set -e
[ "$code" = 1 ] || fail "FIFO in incoming must exit 1 (not hang), got $code"

# a new release keeps the recent hashed chunks of the kept releases (open tabs still request them)
fresh_frontend
ASSETS="Page-old1.js" tarball v2.1.0; deploy frontend v2.1.0 >/dev/null
ASSETS="Page-new2.js" tarball v2.2.0; deploy frontend v2.2.0 >/dev/null
for chunk in Page-old1.js Page-new2.js app.js; do [ -f "$www/releases/v2.2.0/assets/$chunk" ] || fail "v2.2.0 must serve $chunk"; done
ASSETS="Page-new3.js" tarball v2.3.0; deploy frontend v2.3.0 >/dev/null
for chunk in Page-old1.js Page-new2.js Page-new3.js; do [ -f "$www/releases/v2.3.0/assets/$chunk" ] || fail "v2.3.0 must keep $chunk"; done
[ ! -e "$www/releases/v2.1.0/assets/Page-new2.js" ] || fail "old releases are not modified"
# same name, different content: the new release's own file wins
ASSETS="app.js" tarball v2.4.0
deploy frontend v2.4.0 >/dev/null
[ "$(cat "$www/releases/v2.4.0/assets/app.js")" = "chunk app.js" ] || fail "carried files must not overwrite the new release's"

# chunks older than 14 days are not carried, and do not reach later releases either
fresh_frontend
ASSETS="Page-stale.js Page-recent.js" tarball v2.1.0; deploy frontend v2.1.0 >/dev/null
touch -d '20 days ago' "$www/releases/v2.1.0/assets/Page-stale.js"
touch -d '5 days ago' "$www/releases/v2.1.0/assets/Page-recent.js"
tarball v2.2.0; deploy frontend v2.2.0 >/dev/null
[ ! -e "$www/releases/v2.2.0/assets/Page-stale.js" ] || fail "stale chunk must not be carried"
[ -f "$www/releases/v2.2.0/assets/Page-recent.js" ] || fail "recent chunk must be carried"
[ "$(stat -c %Y "$www/releases/v2.2.0/assets/Page-recent.js")" -lt "$(date -d '4 days ago' +%s)" ] || fail "carried chunk keeps its build time"

# an unhealthy new release flips back; rollback still lands on the previous release with its own assets
fresh_frontend
ASSETS="Page-a.js" tarball v2.1.0; deploy frontend v2.1.0 >/dev/null
ASSETS="Page-b.js" tarball v2.2.0; deploy frontend v2.2.0 >/dev/null
ASSETS="Page-c.js" tarball v2.3.0
set +e; STUB_HEALTH=fail deploy frontend v2.3.0 >/dev/null 2>&1; code=$?; set -e
[ "$code" = 1 ] && [ "$(readlink "$www/current")" = releases/v2.2.0 ] || fail "unhealthy release must flip back"
deploy rollback frontend >/dev/null || fail "rollback after carrying assets"
[ "$(readlink "$www/current")" = releases/v2.1.0 ] && [ -f "$www/releases/v2.1.0/assets/Page-a.js" ] || fail "rollback target serves its assets"

# a good deploy keeps only the live image and the rollback target, and removes nothing but qhhoj backend tags
fresh; deploy backend v2.1.0 >/dev/null; deploy backend v2.2.0 >/dev/null; : > "$calls"
STUB_IMAGES="v2.1.0 v2.2.0 v2.3.0 sha-0123456789ab current <none>" deploy backend v2.3.0 >/dev/null || fail "third deploy"
grep -q "podman image ls --format {{.Tag}} ghcr.io/qhhoj/backend-v2$" "$calls" || fail "only the qhhoj backend image is listed"
[ "$(grep '^podman rmi' "$calls" | sort)" = "$(printf '%s\n' 'podman rmi ghcr.io/qhhoj/backend-v2:sha-0123456789ab' 'podman rmi ghcr.io/qhhoj/backend-v2:v2.1.0')" ] \
  || fail "prune removes exactly the tags older than the rollback target: $(grep '^podman rmi' "$calls")"
deploy rollback backend >/dev/null || fail "rollback after the prune"
grep -q "podman tag ghcr.io/qhhoj/backend-v2:v2.2.0 ghcr.io/qhhoj/backend-v2:current" "$calls" || fail "rollback lands on the kept image"
: > "$calls"; set +e; STUB_IMAGES="v2.1.0 v2.2.0 v2.4.0" STUB_HEALTH=fail deploy backend v2.4.0 >/dev/null 2>&1; set -e
grep -q '^podman rmi' "$calls" && fail "a failed deploy prunes nothing"

# a redeploy of the live tag keeps the real rollback target (history is not A, B, B)
fresh; deploy backend v2.1.0 >/dev/null; deploy backend v2.2.0 >/dev/null; : > "$calls"
STUB_IMAGES="v2.1.0 v2.2.0" deploy backend v2.2.0 --force >/dev/null || fail "redeploy of the live tag"
grep -q '^podman rmi' "$calls" && fail "a redeploy of the live tag pruned $(grep '^podman rmi' "$calls")"
[ "$(hist)" = "$(printf 'v2.1.0\nv2.2.0')" ] || fail "a redeploy adds no history entry: $(hist | tr '\n' ' ')"
: > "$calls"; deploy rollback backend >/dev/null || fail "rollback after a redeploy"
grep -q "podman tag ghcr.io/qhhoj/backend-v2:v2.1.0 ghcr.io/qhhoj/backend-v2:current" "$calls" || fail "rollback after a redeploy lands on v2.1.0"

# a good frontend deploy keeps the live release and the rollback target only
fresh_frontend
for v in v2.1.0 v2.2.0 v2.3.0; do tarball "$v"; deploy frontend "$v" >/dev/null || fail "frontend $v"; done
[ "$(ls "$www/releases")" = "$(printf 'v2.2.0\nv2.3.0')" ] || fail "releases kept: $(ls "$www/releases" | tr '\n' ' ')"
deploy rollback frontend >/dev/null && [ "$(readlink "$www/current")" = releases/v2.2.0 ] || fail "rollback lands on the kept release"

fresh_frontend
for v in v2.1.0 v2.2.0 v2.2.0; do tarball "$v"; deploy frontend "$v" >/dev/null || fail "frontend $v"; done
[ "$(ls "$www/releases")" = "$(printf 'v2.1.0\nv2.2.0')" ] || fail "a frontend redeploy keeps the rollback target: $(ls "$www/releases" | tr '\n' ' ')"
[ "$(fhist)" = "$(printf 'v2.1.0\nv2.2.0')" ] || fail "a frontend redeploy adds no history entry"

echo "qhhoj-deploy backend ok"
