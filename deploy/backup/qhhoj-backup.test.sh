#!/usr/bin/env bash
# deploy/backup/qhhoj-backup.test.sh: qhhoj-backup against real restic repositories in a temp dir, with stub mongodump
# and curl (no MongoDB: CI is service-free). Needs restic on PATH.
# shellcheck disable=SC2015 # `check && check || fail`: fail runs when a check failed, which is the point
set -euo pipefail
# grep -c, not grep -q, after restic: -q exits at the first match and pipefail turns restic's SIGPIPE into a failure.
here="$(cd "$(dirname "$0")" && pwd)"
command -v restic >/dev/null || { echo "qhhoj-backup.test: restic is not installed" >&2; exit 1; }
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
bin="$work/bin" calls="$work/calls" out="$work/out"
export RESTIC_PASSWORD='test pass' RESTIC_CACHE_DIR="$work/cache" QHHOJ_BACKUP_ENV="$work/backup.env" PATH="$bin:$PATH"
fail() { echo "FAIL: $*" >&2; cat "$out" "$calls" >&2 2>/dev/null || true; exit 1; }

mkdir -p "$bin" "$work/data/problem-data/p1" "$work/data/media"
echo tests > "$work/data/problem-data/p1/tests.zip"; echo img > "$work/data/media/a.png"
# mongodump stub: records its argv and its --config file, writes an archive or (STUB_DUMP_FAIL) a partial one and fails.
cat > "$bin/mongodump" <<EOF
#!/usr/bin/env bash
echo "mongodump \$*" >> "$calls"
while [ \$# -gt 0 ]; do [ "\$1" = --config ] && cat "\$2" >> "$work/mongodump-config"; shift; done
if [ -n "\${STUB_DUMP_FAIL:-}" ]; then printf partial; exit 2; fi
printf 'archive-%s' "\${STUB_NIGHT:-1}"
EOF
# shellcheck disable=SC2016 # $* belongs to the stub
printf '#!/usr/bin/env bash\necho "curl ${*: -1}" >> "%s"\n' "$calls" > "$bin/curl"
chmod +x "$bin/mongodump" "$bin/curl"

config() { # [extra lines]: a fresh env file
  cat > "$QHHOJ_BACKUP_ENV" <<EOF
RESTIC_PASSWORD='$RESTIC_PASSWORD'
MONGO_BACKUP_URL='mongodb://qhhoj-backup@127.0.0.1:27017/?authSource=admin&replicaSet=rs0'
MONGO_BACKUP_PASSWORD='s3cret it'"'"'s'
LOCAL_REPO=$work/local
DATA_PATHS='$work/data/problem-data $work/data/media'
HEALTHCHECK_URL=https://hc.example/ping/abc
EOF
  printf '%s\n' "$@" >> "$QHHOJ_BACKUP_ENV"
}
fresh() { rm -rf "$work/local" "$work/offsite" "$work/mongodump-config"; : > "$calls"; for r in local offsite; do restic init -q -r "$work/$r"; done; }
backup() { TMPDIR="$work" bash "$here/qhhoj-backup" > "$out" 2>&1; }
count() { restic -r "$work/$1" snapshots --json --tag "$2" | grep -o '"id"' | wc -l; }
latest_id() { restic -r "$work/$1" snapshots --json --tag "$2" --latest 1 | grep -o '"id":"[0-9a-f]*"'; }
archive() { restic -r "$work/$1" dump --tag qhhoj-db latest /qhhoj-mongo.archive; }

# No offsite: the database goes to the local repository, the files are reported as not backed up.
fresh; config; backup || fail "local-only run"
[ "$(count local qhhoj-db)" = 1 ] || fail "one local database snapshot"
[ "$(archive local)" = archive-1 ] || fail "the snapshot holds mongodump's whole output"
restic -r "$work/local" snapshots --json --tag qhhoj-db,oplog | grep -c '"id"' >/dev/null || fail "oplog dump tagged oplog"
grep -q 'are NOT' "$out" || fail "a run without OFFSITE_REPO says the files are not backed up"
grep -q 'mongodump .*--oplog' "$calls" || fail "point-in-time dump by default"
grep -q 's3cret' "$calls" && fail "the password must not be in mongodump's argv"
grep -qx "password: 's3cret it''s'" "$work/mongodump-config" || fail "the password reaches mongodump through its config file"
grep -qx 'curl https://hc.example/ping/abc/start' "$calls" && grep -qx 'curl https://hc.example/ping/abc' "$calls" \
  || fail "health check start and success pings"

# Offsite: database and files; a second night adds a snapshot of each.
fresh; config "OFFSITE_REPO=$work/offsite"; backup || fail "offsite run"
echo more > "$work/data/media/b.png"; STUB_NIGHT=2 backup || fail "second run"
[ "$(count local qhhoj-db)" = 2 ] && [ "$(count offsite qhhoj-db)" = 2 ] && [ "$(count offsite qhhoj-files)" = 2 ] \
  || fail "two nights: two snapshots of each kind"
[ "$(archive offsite)" = archive-2 ] || fail "offsite holds the newest dump"
restic -r "$work/offsite" ls latest --tag qhhoj-files | grep -c '/media/b.png$' >/dev/null || fail "files snapshot holds DATA_PATHS"
restic -r "$work/local" ls latest --tag qhhoj-db | grep -c problem-data >/dev/null && fail "the local repository never holds files"

# A failed mongodump fails the run and leaves no snapshot behind; the files are still backed up.
files_before="$(latest_id offsite qhhoj-files)"
: > "$calls"; STUB_DUMP_FAIL=1 backup && fail "a failed mongodump must fail the run"
[ "$(archive local)" = archive-2 ] && [ "$(archive offsite)" = archive-2 ] || fail "the partial dump's snapshots are forgotten"
[ "$(count local qhhoj-db)" = 2 ] && [ "$(count offsite qhhoj-db)" = 2 ] || fail "no good snapshot is lost to a failed night"
[ "$(latest_id offsite qhhoj-files)" != "$files_before" ] || fail "the files step runs although the database step failed"
grep -q 'failed: local database,offsite database' "$out" || fail "the failed steps are named"
grep -qx 'curl https://hc.example/ping/abc/fail' "$calls" || fail "failure ping"

# The free-space floor refuses the local backup (the site and the judge share the disk).
fresh; config "LOCAL_MIN_FREE_GB=999999999"; backup && fail "below the floor must fail"
[ "$(count local qhhoj-db)" = 0 ] || fail "no local snapshot below the floor"
grep -q 'local backup refused' "$out" || fail "the refusal is logged"

# MONGO_OPLOG=0: a plain dump, not tagged oplog.
fresh; config MONGO_OPLOG=0; backup || fail "plain dump run"
grep -q -- '--oplog' "$calls" && fail "MONGO_OPLOG=0 must not pass --oplog"
restic -r "$work/local" snapshots --json --tag oplog | grep -c '"id"' >/dev/null && fail "a plain dump is not tagged oplog"

# Bad configuration exits 64.
rm "$QHHOJ_BACKUP_ENV"; set +e; backup; rc=$?; set -e
[ "$rc" = 64 ] || fail "missing env file exits 64, got $rc"
config; sed -i '/^MONGO_BACKUP_PASSWORD=/d' "$QHHOJ_BACKUP_ENV"; set +e; backup; rc=$?; set -e
[ "$rc" = 64 ] || fail "missing MONGO_BACKUP_PASSWORD exits 64, got $rc"
echo "qhhoj-backup ok"
