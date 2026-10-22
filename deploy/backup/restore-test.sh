#!/usr/bin/env bash
# restore-test.sh (root): restores the newest database snapshot into a throwaway mongod and compares its collection
# counts with the live database; touches nothing live. Installed as /usr/local/sbin/qhhoj-backup-restore-test.
#   qhhoj-backup-restore-test [local|offsite]   (default local)
# Run it right after a backup: counts may drift by RESTORE_TEST_TOLERANCE_PCT (default 2) or 10 documents.
# Exit: 0 restored and counts match, 1 restore failed or counts differ, 64 bad configuration.
set -euo pipefail
export LC_ALL=C # sort and join must agree on the order

ENV_FILE="${QHHOJ_BACKUP_ENV:-/etc/qhhoj/backup.env}"
DB_TAG=qhhoj-db
OPLOG_TAG=oplog
ARCHIVE_NAME=qhhoj-mongo.archive
MIN_SLACK=10
EX_CONFIG=64

log() { echo "restore-test: $*"; }
die() { echo "restore-test: $*" >&2; exit "$EX_CONFIG"; }
fail() { echo "restore-test: FAIL: $*" >&2; exit 1; }

load_config() {
  [ -r "$ENV_FILE" ] || die "cannot read $ENV_FILE"
  set -a
  # shellcheck source=/dev/null
  . "$ENV_FILE"
  set +a
  [ -n "${RESTIC_PASSWORD:-}" ] || die "RESTIC_PASSWORD is not set"
  [ -n "${MONGO_BACKUP_URL:-}" ] || die "MONGO_BACKUP_URL is not set"
  [ -n "${MONGO_BACKUP_PASSWORD:-}" ] || die "MONGO_BACKUP_PASSWORD is not set"
  export -n MONGO_BACKUP_URL MONGO_BACKUP_PASSWORD
  MONGO_DB="${MONGO_DB:-qhhoj}"
  SCRATCH_PARENT="${RESTORE_TEST_DIR:-/backup/restore-test}"
  PORT="${RESTORE_TEST_PORT:-27999}"
  TOLERANCE_PCT="${RESTORE_TEST_TOLERANCE_PCT:-2}"
  MIN_FREE_GB="${RESTORE_TEST_MIN_FREE_GB:-1}"
  export RESTIC_CACHE_DIR="${RESTIC_CACHE_DIR:-/var/cache/qhhoj-backup}"
}

pick_repo() { # local | offsite
  case "${1:-local}" in
    local) REPO="${LOCAL_REPO:-/backup/restic}" ;;
    offsite) REPO="${OFFSITE_REPO:-}"; [ -n "$REPO" ] || die "OFFSITE_REPO is not set" ;;
    *) die "usage: $0 [local|offsite]" ;;
  esac
}

find_snapshot() { # sets SNAPSHOT and OPLOG from the newest database snapshot
  local json
  json="$(restic -r "$REPO" snapshots --tag "$DB_TAG" --latest 1 --json)" || fail "cannot list snapshots in $REPO"
  SNAPSHOT="$(grep -o '"id":"[0-9a-f]*"' <<< "$json" | tail -n 1 | cut -d'"' -f4)"
  [ -n "$SNAPSHOT" ] || fail "no $DB_TAG snapshot in $REPO"
  OPLOG=0
  if grep -q "\"$OPLOG_TAG\"" <<< "$json"; then OPLOG=1; fi
  log "snapshot $SNAPSHOT from $REPO (oplog: $OPLOG)"
}

check_space() { # the archive size bounds the restored database; MIN_FREE_GB more stays free for the site and the judge
  local size free
  size="$(restic -r "$REPO" stats --mode restore-size --json "$SNAPSHOT" | grep -o '"total_size":[0-9]*' | cut -d: -f2)"
  free=$(($(df -Pk "$SCRATCH_PARENT" | awk 'NR == 2 { print $4 }') * 1024))
  [ "$free" -ge $((size + MIN_FREE_GB * 1024 * 1024 * 1024)) ] \
    || fail "$((free >> 20)) MiB free in $SCRATCH_PARENT; the archive is $((size >> 20)) MiB plus RESTORE_TEST_MIN_FREE_GB=$MIN_FREE_GB"
}

start_scratch_mongod() { # small cache and lowest priority: the site and the judge share the host
  SCRATCH="$(mktemp -d "$SCRATCH_PARENT/run.XXXXXX")"
  trap stop_scratch_mongod EXIT
  mkdir "$SCRATCH/db"
  nice -n 19 ionice -c 3 mongod --dbpath "$SCRATCH/db" --port "$PORT" --bind_ip 127.0.0.1 \
    --wiredTigerCacheSizeGB 0.25 --fork --logpath "$SCRATCH/mongod.log" --pidfilepath "$SCRATCH/mongod.pid" >/dev/null \
    || fail "scratch mongod did not start on port $PORT (log: $SCRATCH/mongod.log)"
}

stop_scratch_mongod() {
  [ -n "${SCRATCH:-}" ] || return 0
  if [ -f "$SCRATCH/mongod.pid" ]; then mongod --dbpath "$SCRATCH/db" --shutdown >/dev/null 2>&1 || true; fi
  rm -rf "$SCRATCH"
}

restore_snapshot() { # the whole archive: mongorestore refuses --oplogReplay with namespace filters
  local replay=()
  [ "$OPLOG" = 0 ] || replay=(--oplogReplay)
  restic -r "$REPO" dump "$SNAPSHOT" "/$ARCHIVE_NAME" \
    | nice -n 19 mongorestore --host 127.0.0.1 --port "$PORT" --archive --drop "${replay[@]}" \
    || fail "restore of $SNAPSHOT failed"
}

collection_counts() { # url [password]: "<collection> <count>" per collection of MONGO_DB, sorted
  # The password goes through the environment, never argv.
  # shellcheck disable=SC2016 # JavaScript, not shell
  QHHOJ_COUNT_URL="$1" QHHOJ_COUNT_PASSWORD="${2:-}" QHHOJ_COUNT_DB="$MONGO_DB" mongosh --nodb --quiet --eval '
    const url = new URL(process.env.QHHOJ_COUNT_URL);
    if (process.env.QHHOJ_COUNT_PASSWORD) url.password = process.env.QHHOJ_COUNT_PASSWORD;
    const db = connect(url.toString()).getSiblingDB(process.env.QHHOJ_COUNT_DB);
    for (const c of db.getCollectionInfos({ type: "collection" })) {
      if (!c.name.startsWith("system.")) print(c.name + " " + db.getCollection(c.name).estimatedDocumentCount());
    }' | sort
}

compare_counts() { # live restored: every collection on both sides, counts within the tolerance
  join -a1 -a2 -e missing -o 0,1.2,2.2 "$1" "$2" | awk -v pct="$TOLERANCE_PCT" -v slack="$MIN_SLACK" '
    { live = $2; restored = $3; verdict = "ok" }
    live == "missing" || restored == "missing" { verdict = "MISSING" }
    verdict == "ok" {
      diff = live - restored; if (diff < 0) diff = -diff
      allowed = int(live * pct / 100); if (allowed < slack) allowed = slack
      if (diff > allowed) verdict = "DIFFERS"
    }
    { printf "%-40s live %-12s restored %-12s %s\n", $1, live, restored, verdict; if (verdict != "ok") bad++ }
    END { exit bad > 0 }'
}

main() {
  load_config
  pick_repo "${1:-local}"
  mkdir -p "$SCRATCH_PARENT"
  find_snapshot
  check_space
  start_scratch_mongod
  restore_snapshot
  collection_counts "$MONGO_BACKUP_URL" "$MONGO_BACKUP_PASSWORD" > "$SCRATCH/live"
  collection_counts "mongodb://127.0.0.1:$PORT/" > "$SCRATCH/restored"
  [ -s "$SCRATCH/live" ] || fail "the live database $MONGO_DB has no collections"
  compare_counts "$SCRATCH/live" "$SCRATCH/restored" || fail "restored counts differ from the live database"
  log "ok: $(wc -l < "$SCRATCH/restored") collections restored from $SNAPSHOT match the live database"
}

main "$@"
