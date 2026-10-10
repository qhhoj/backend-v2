#!/usr/bin/env bash
# deploy/migrate/qhhoj-migrate.test.sh: qhhoj-migrate against a fake root with stub podman/systemctl/mongosh/rsync/df/openssl.
# shellcheck disable=SC2015,SC2016 # stub bodies are written literally into fake binaries
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(mktemp -d)"; bin="$(mktemp -d)"; trap 'rm -rf "$root" "$bin"' EXIT
calls="$root/calls"
fail() { echo "FAIL: $*" >&2; cat "$calls" >&2; exit 1; }
stub() { printf '#!/usr/bin/env bash\necho "%s $*" >> "%s"\n%s\n' "$1" "$calls" "${2:-}" > "$bin/$1"; chmod +x "$bin/$1"; }

SECRET=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
fresh() {
  rm -rf "${root:?}"/*
  mkdir -p "$root/run" "$root/etc/qhhoj" "$root/root" "$root/srv/qhhoj" "$root/srv/qhhoj-migrate/incoming/media" \
    "$root/srv/qhhoj-migrate/incoming/problem-data" "$root/var/log/qhhoj-migrate"
  printf 'MONGO_URL=mongodb://m\nREDIS_URL=redis://r\nMEDIA_URL=/media\nENCRYPTION_KEY=%s\nPORT=3000\nSITE_URL=https://oj.test\n' "$SECRET" > "$root/etc/qhhoj/env"
  printf 'MONGO_URL=mongodb://m\nREDIS_URL=redis://r\nMEDIA_URL=/media\nENCRYPTION_KEY=%s\nLEGACY_SECRET_KEY=s\nDAY_ONE_LANGUAGES=CPP17,PY3\n' "$SECRET" > "$root/root/migrate.env"
  chmod 600 "$root/etc/qhhoj/env" "$root/root/migrate.env"
  echo 'LEGACY_MYSQL_URL=mysql://root:pw@127.0.0.1:3307/legacy' > "$root/srv/qhhoj-migrate/legacy.env"
  : > "$calls"
  stub podman 'case "$*" in *"inspect"*) echo true ;; esac; for s in ${STUB_FAIL:-}; do case " $* " in *" $s "*) exit 3 ;; esac; done; true'
  stub systemctl 'case "$*" in *is-active*) exit 3 ;; esac; true'
  stub mongosh 'echo "${STUB_RESERVED:-0}"'
  stub rsync; stub chown; stub openssl 'echo pw'
  stub df 'printf "Avail\n%s\n" "${STUB_FREE:-999999999999}"'
}
migrate() { PATH="$bin:$PATH" QHHOJ_MIGRATE_ROOT="$root" bash "$here/qhhoj-migrate" "$@"; }
steps_run() { grep -oE 'backend-v2:current [a-z-]+' "$calls" | awk '{print $2}' | paste -sd' '; }

fresh; out="$(migrate run 2>&1)" || { echo "$out"; fail "good run"; }
[ "$(steps_run)" = "audit backfill grant-permissions verify recompute check-files check-integrity stamp-data-versions count-data-shapes prune-languages prune-languages" ] || fail "step order: $(steps_run)"
grep -q -- "--keep CPP17,PY3,OUTPUT --dry-run" "$calls" || fail "prune dry run keeps OUTPUT"
grep -q "systemctl start qhhoj-worker" "$calls" && grep -q "systemctl stop qhhoj-worker" "$calls" || fail "worker started and stopped around recompute"
grep -q "systemctl stop qhhoj.target" "$calls" || fail "run stops the site first"
[ -s "$root/srv/qhhoj-migrate/last-run-ok" ] || fail "last-run-ok written"
logdir="$(cat "$root/srv/qhhoj-migrate/last-run-ok")"
[ -s "$logdir/summary.txt" ] && [ -s "$logdir/timings.tsv" ] || fail "summary and timings"

fresh; sed -i "s/^ENCRYPTION_KEY=.*/ENCRYPTION_KEY=other/" "$root/root/migrate.env"
set +e; out="$(migrate run 2>&1)"; code=$?; set -e
[ "$code" != 0 ] || fail "key mismatch must stop"
grep -q "ENCRYPTION_KEY" <<<"$out" || fail "names the key"
grep -q -e "$SECRET" -e other <<<"$out" && fail "must not print secret values"
grep -q "backend-v2:current" "$calls" && fail "no migrator step before preflight passes"

fresh; echo MIGRATION_REHEARSAL=1 >> "$root/root/migrate.env"
migrate run >/dev/null 2>&1 && fail "MIGRATION_REHEARSAL must refuse"
fresh; MIGRATION_REHEARSAL=1 migrate run >/dev/null 2>&1 && fail "MIGRATION_REHEARSAL in the environment must refuse"
fresh; sed -i '/^DAY_ONE_LANGUAGES=/d' "$root/root/migrate.env"
migrate run >/dev/null 2>&1 && fail "missing DAY_ONE_LANGUAGES must refuse"
fresh; chmod 644 "$root/root/migrate.env"
migrate run >/dev/null 2>&1 && fail "world-readable migrate.env must refuse"

fresh; set +e; STUB_FAIL=verify migrate run >/dev/null 2>&1; code=$?; set -e
[ "$code" != 0 ] || fail "failing step must fail the run"
[ "$(steps_run)" = "audit backfill grant-permissions verify" ] || fail "stop at the first failing step: $(steps_run)"
[ ! -e "$root/srv/qhhoj-migrate/last-run-ok" ] || fail "failed run must not write last-run-ok"

fresh; STUB_FAIL=recompute migrate run >/dev/null 2>&1 && fail "recompute failure fails"
grep -q "systemctl stop qhhoj-worker" "$calls" || fail "worker stopped even when recompute fails"

fresh; STUB_RESERVED=2 migrate run >/dev/null 2>&1 && fail "reserved problem codes must stop"

fresh; touch "$root/srv/qhhoj-migrate/went-live"
migrate run >/dev/null 2>&1 && fail "run after go-live must refuse"

fresh; exec 8>"$root/run/qhhoj-migrate.lock"; flock 8
migrate run >/dev/null 2>&1 && fail "second run while locked must refuse"
exec 8>&-
echo "qhhoj-migrate run ok"
