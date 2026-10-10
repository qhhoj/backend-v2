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
MONGO=mongodb://m
GENPW=GENPW7731
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
  stub rsync; stub chown; stub openssl 'case "$1" in rand) echo GENPW7731 ;; passwd) cat >/dev/null; echo HASHED ;; esac'
  stub df 'printf "Avail\n%s\n" "${STUB_FREE:-999999999999}"'
}
migrate() { PATH="$bin:$PATH" QHHOJ_MIGRATE_ROOT="$root" bash "$here/qhhoj-migrate" "$@"; }
# integrity_output <text>: podman's check-integrity prints <text> and exits 1
integrity_output() {
  printf '%s\n' "$1" > "$root/integrity.out"
  stub podman "case \"\$*\" in *inspect*) echo true ;; *check-integrity*) cat '$root/integrity.out'; exit 1 ;; esac"
}
# recompute_fails_times <n>: the first n migrator recompute calls find no worker
recompute_fails_times() {
  cat > "$root/recompute.sh" <<EOF
n=\$(cat "$root/recompute.count" 2>/dev/null || echo 0); n=\$((n + 1)); echo "\$n" > "$root/recompute.count"
if [ "\$n" -le $1 ]; then echo 'no worker on migration-recompute'; exit 1; fi
EOF
  stub podman "case \"\$*\" in *inspect*) echo true ;; *recompute*) bash '$root/recompute.sh' ;; esac"
}
COVERAGE=$'[Nest] 1 ERROR [check-integrity] legacy-rated participations without a v2 rating: 3\n[Nest] 1 ERROR [check-integrity]   judge_contest:5: 3\n[Nest] 1 ERROR [check-integrity] rated contests: legacy 4, v2 3\n[Nest] 1 LOG [check-integrity] 3 broken invariant(s)'
COLOURED=$'\e[31m  ERROR\e[39m \e[38;5;3m[check-integrity] \e[39m\e[31mlegacy-rated participations without a v2 rating: 3\e[39m\n\e[31m  ERROR\e[39m \e[38;5;3m[check-integrity] \e[39m\e[31m  judge_contest:5: 3\e[39m'
REFERENCE=$'[Nest] 1 ERROR [check-integrity] submissions without a source: 2\n[Nest] 1 ERROR [check-integrity] legacy-rated participations without a v2 rating: 3'
steps_run() { grep -oE 'backend-v2:current [a-z-]+' "$calls" | awk '{print $2}' | paste -sd' '; }

fresh; out="$(migrate run 2>&1)" || { echo "$out"; fail "good run"; }
[ "$(steps_run)" = "audit backfill grant-permissions verify recompute check-files check-integrity stamp-data-versions count-data-shapes prune-languages prune-languages" ] || fail "step order: $(steps_run)"
grep -q -- "--keep CPP17,PY3,OUTPUT --dry-run" "$calls" || fail "prune dry run keeps OUTPUT"
grep -q "systemctl start qhhoj-worker" "$calls" && grep -q "systemctl stop qhhoj-worker" "$calls" || fail "worker started and stopped around recompute"
grep -q "systemctl stop qhhoj.target" "$calls" || fail "run stops the site first"
[ -s "$root/srv/qhhoj-migrate/last-run-ok" ] || fail "last-run-ok written"
logdir="$(cat "$root/srv/qhhoj-migrate/last-run-ok")"
[ -s "$logdir/summary.txt" ] && [ -s "$logdir/timings.tsv" ] || fail "summary and timings"
grep -q -- "-e NO_COLOR=1 " "$calls" || fail "migrator output is uncoloured"
grep -q -- "-e MEDIA_ROOT=/srv/qhhoj/media " "$calls" && grep -q -- "-e PROBLEM_DATA_ROOT=/srv/qhhoj/problem-data " "$calls" || fail "migrator gets the file roots"

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
fresh; stub curl 'case "$*" in *http_code*) echo 404 ;; esac; true'; stub mongodump; stub nginx
echo nope | migrate go-live >/dev/null 2>&1 && fail "go-live without a good run must refuse"
migrate run >/dev/null 2>&1
echo yes | migrate go-live >/dev/null 2>&1 && fail "go-live needs the typed word"
grep -q " finish" "$calls" && fail "no finish without the typed word"
echo go-live | migrate go-live >/dev/null || fail "go-live"
grep -q "backend-v2:current finish" "$calls" || fail "finish ran"
grep -q "mongodump" "$calls" && grep -q "systemctl start qhhoj.target" "$calls" || fail "dump and start"
[ -e "$root/srv/qhhoj-migrate/went-live" ] || fail "went-live written"
[ "$(grep -n 'mongodump' "$calls" | cut -d: -f1)" -lt "$(grep -n 'start qhhoj.target' "$calls" | cut -d: -f1)" ] || fail "dump before start"

fresh; stub nginx; mkdir -p "$root/etc/nginx/snippets"
out="$(migrate preview on staff)" || fail "preview on"
grep -q "auth_basic" "$root/etc/nginx/snippets/qhhoj-gate.conf" || fail "gate written"
grep -q "allow 127.0.0.1" "$root/etc/nginx/snippets/qhhoj-gate.conf" || fail "loopback exempt"
grep -q "^staff:" "$root/etc/nginx/qhhoj-preview.htpasswd" || fail "htpasswd"
grep -q "password" <<<"$out" || fail "prints the password once"
migrate preview off >/dev/null || fail "preview off"
grep -q "auth_basic" "$root/etc/nginx/snippets/qhhoj-gate.conf" && fail "gate emptied"
migrate status >/dev/null || fail "status"
# --- fix round 1 ---
# C1: a container started by import-dump must not keep the lock
fresh; printf 'SELECT 1;\n' | gzip > "$root/dump.sql.gz"
bg_pid="$root/bg.pid"
stub podman "case \"\$*\" in *inspect*) echo true ;; 'exec -i'*) cat >/dev/null ;; 'run -d'*) sleep 30 & echo \$! > '$bg_pid' ;; esac"
migrate import-dump "$root/dump.sql.gz" >/dev/null 2>&1 || fail "import-dump"
run_rc=0; out="$(migrate run 2>&1)" || run_rc=$?
kill "$(cat "$bg_pid")" 2>/dev/null || true
[ "$run_rc" = 0 ] || fail "run after import-dump: $out"
grep -q -e "$GENPW" -e "$MONGO" -e "$SECRET" "$calls" && fail "import-dump put a secret in argv"

# I2: a failed media rsync stops the run at sync-files; a worker that does not start fails recompute
fresh; stub rsync 'case "$*" in *"/incoming/media/"*) exit 23 ;; esac; true'
migrate run >/dev/null 2>&1 && fail "failed media sync must fail the run"
[ "$(steps_run)" = "audit backfill grant-permissions verify recompute" ] || fail "sync-files stops the run: $(steps_run)"
fresh; stub systemctl 'case "$*" in *"start qhhoj-worker"*) exit 1 ;; *is-active*) exit 3 ;; esac; true'
migrate run >/dev/null 2>&1 && fail "worker that does not start must fail recompute"

# I4: rating coverage is accepted only with the flag, and only when it is the sole problem
fresh; integrity_output "$COVERAGE"
migrate run --accept-rating-coverage >/dev/null 2>&1 || fail "rating coverage accepted with the flag"
grep -q "stamp-data-versions" "$calls" || fail "run continues past accepted coverage"
logdir="$(cat "$root/srv/qhhoj-migrate/last-run-ok")"
grep -q "check-integrity: rating coverage accepted" "$logdir/summary.txt" || fail "accepted coverage recorded"
fresh; integrity_output "$COVERAGE"
migrate run >/dev/null 2>&1 && fail "rating coverage stops without the flag"
[ "$(steps_run)" = "audit backfill grant-permissions verify recompute check-files check-integrity" ] || fail "stops at check-integrity: $(steps_run)"
fresh; integrity_output "$COLOURED"
migrate run --accept-rating-coverage >/dev/null 2>&1 || fail "coloured rating coverage is accepted with the flag"
fresh; integrity_output "$REFERENCE"
migrate run --accept-rating-coverage >/dev/null 2>&1 && fail "a reference failure stops even with the flag"
[ "$(steps_run)" = "audit backfill grant-permissions verify recompute check-files check-integrity" ] || fail "reference failure stops at check-integrity"

# I5: no-worker is retried up to 12 times; the worker is stopped afterwards
fresh; recompute_fails_times 2
migrate run >/dev/null 2>&1 || fail "recompute retries while no worker is registered"
[ "$(cat "$root/recompute.count")" = 3 ] || fail "three recompute attempts"
grep -q "systemctl stop qhhoj-worker" "$calls" || fail "worker stopped after retries"

# I6: go-live resumes after a failed smoke test without a second finish
fresh; stub mongodump "stat -c %a \"\$2\" > '$root/cfgmode'; cp \"\$2\" '$root/cfgcopy'"; stub nginx
stub curl "case \"\$*\" in *problems*) [ -e '$root/smoke-ok' ] || exit 22 ;; *http_code*) echo 404 ;; esac"
migrate run >/dev/null 2>&1 || fail "run before go-live"
echo go-live | migrate go-live >/dev/null 2>&1 && fail "a failed smoke test must fail go-live"
[ -e "$root/srv/qhhoj-migrate/went-live" ] || fail "went-live kept after a failed smoke test"
touch "$root/smoke-ok"
echo go-live | migrate go-live >/dev/null || fail "go-live resumes"
[ "$(grep -c 'backend-v2:current finish' "$calls")" = 1 ] || fail "finish runs once"
# I7: the Mongo URI reaches mongodump through a 600 config file, never argv
grep -qx 600 "$root/cfgmode" || fail "dump config is mode 600"
grep -q "uri: 'mongodb://m'" "$root/cfgcopy" || fail "dump config holds the uri"
[ -z "$(ls "$root/srv/qhhoj-migrate"/mongodump.* 2>/dev/null)" ] || fail "dump config removed after go-live"
grep -q -e "$MONGO" "$calls" && fail "mongo uri in argv"

# I7: the preview password reaches openssl on stdin, not argv
fresh; stub nginx; mkdir -p "$root/etc/nginx/snippets"
migrate preview on staff >/dev/null || fail "preview on"
grep -q "$GENPW" "$calls" && fail "preview password in argv"


# M3: import-dump refuses after go-live
fresh; touch "$root/srv/qhhoj-migrate/went-live"; printf 'x' | gzip > "$root/dump.sql.gz"
migrate import-dump "$root/dump.sql.gz" >/dev/null 2>&1 && fail "import-dump after go-live must refuse"

# 8: run and go-live wait for, then refuse behind, a held deploy lock
fresh; exec 8>"$root/run/qhhoj-deploy.lock"; flock 8
QHHOJ_MIGRATE_LOCK_WAIT=1 migrate run >/dev/null 2>&1 && fail "run must refuse while a deploy holds the lock"
exec 8>&-
grep -q "backend-v2" "$calls" && fail "no migrator step behind a deploy"
# Task 14: snapshot copies the old site read-only and renames the dump only on success
fresh; stub mysqldump 'echo SQL'; stub rsync
echo 'LEGACY_DB_NAME=oldsite' >> "$root/root/migrate.env"; echo 'LEGACY_MEDIA_DIR=/old/media' >> "$root/root/migrate.env"
migrate snapshot >/dev/null || fail "snapshot"
ls "$root/srv/qhhoj-migrate/incoming"/legacy-*.sql.gz >/dev/null 2>&1 || fail "snapshot writes .sql.gz"
ls "$root/srv/qhhoj-migrate/incoming"/*.part >/dev/null 2>&1 && fail "no .part left after success"
grep -q "mysqldump --single-transaction --quick --routines --default-character-set=utf8mb4 oldsite" "$calls" || fail "dump flags and db name"
grep -q "rsync -a --delete /old/media/ " "$calls" || fail "media rsync from the configured dir"
grep -q "rsync -a --delete /qhh/problems/ " "$calls" || fail "problem data rsync defaults to /qhh/problems"
fresh; stub mysqldump 'echo SQL'; stub rsync
migrate snapshot >/dev/null || fail "snapshot with defaults"
grep -q "mysqldump --single-transaction --quick --routines --default-character-set=utf8mb4 qhhoj$" "$calls" || fail "db name defaults to qhhoj"
grep -q "rsync -a --delete /qhh/media/ " "$calls" || fail "media defaults to /qhh/media"
fresh; stub mysqldump 'echo partial; exit 2'; stub rsync
set +e; migrate snapshot >/dev/null 2>&1; code=$?; set -e
[ "$code" != 0 ] || fail "failing mysqldump must fail the snapshot"
ls "$root/srv/qhhoj-migrate/incoming"/legacy-*.sql.gz >/dev/null 2>&1 && fail "no .sql.gz after a failed dump"
ls "$root/srv/qhhoj-migrate/incoming"/*.part >/dev/null 2>&1 && fail "failed dump removes its .part"
grep -q "rsync" "$calls" && fail "no file copy after a failed dump"
# S1: the legacy dump and its directories are private, whatever the caller's umask
fresh; stub mysqldump 'echo SQL'; stub rsync; umask 022
migrate snapshot >/dev/null || fail "snapshot under umask 022"
[ "$(stat -c %a "$root/srv/qhhoj-migrate")" = 700 ] || fail "work dir is mode 700"
[ "$(stat -c %a "$root/srv/qhhoj-migrate/incoming")" = 700 ] || fail "incoming is mode 700"
[ "$(stat -c %a "$root/srv/qhhoj-migrate/incoming"/legacy-*.sql.gz)" = 600 ] || fail "dump is mode 600"
# snapshot refuses without /root/migrate.env and dumps nothing
fresh; stub mysqldump 'echo SQL'; stub rsync; rm -f "$root/root/migrate.env"
set +e; migrate snapshot >/dev/null 2>&1; code=$?; set -e
[ "$code" != 0 ] || fail "snapshot without migrate.env must fail"
grep -q "mysqldump" "$calls" && fail "no dump without migrate.env"
echo "qhhoj-migrate run ok"
