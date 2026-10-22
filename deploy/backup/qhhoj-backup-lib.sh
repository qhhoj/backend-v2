# shellcheck shell=bash
# qhhoj-backup-lib.sh: restic steps shared by qhhoj-backup (host) and qhhoj-pull (owner laptop), and the mongodump
# config that qhhoj-backup and qhhoj-pull-serve hand over. Sourced, never run; installed beside the scripts that source it.
# The caller defines log, and sets KEEP (retention flags), STATE_DIR (kept between runs), WORK (a private temp dir) and
# MONGO_OPLOG (1: the dump holds the oplog) before calling db_snapshot or maintain.
DB_TAG=qhhoj-db
FILES_TAG=qhhoj-files
OPLOG_TAG=oplog # the archive holds the oplog: restore it with --oplogReplay
ARCHIVE_NAME=qhhoj-mongo.archive
CHECK_EVERY_MIN=$((6 * 24 * 60 + 12 * 60)) # about weekly `restic check` that also reads a sample of the stored data
CHECK_SUBSET=5%
FAILED=()
DUMP_RC=0 # exit status of the last db_snapshot producer (qhhoj-pull: 255 = ssh could not reach the host)

mongodump_config() { # YAML for mongodump --config: the password stays out of argv and of mongodump's error messages
  local q="'" qq="''"
  printf "uri: '%s'\npassword: '%s'\n" "${MONGO_BACKUP_URL//$q/$qq}" "${MONGO_BACKUP_PASSWORD//$q/$qq}"
}

free_kib() { # free KiB on the filesystem that holds $1 (its nearest existing parent before `restic init`)
  local dir="$1"
  while [ ! -e "$dir" ]; do dir="$(dirname "$dir")"; done
  df -Pk "$dir" | awk 'NR == 2 { print $4 }'
}

space_ok() { # dir floor_gb setting: refuse (1) below the floor; the disk is shared with everything else on the machine
  local free floor=$(($2 * 1024 * 1024))
  free="$(free_kib "$1")"
  [ "$free" -ge "$floor" ] && return 0
  log "only $((free / 1024)) MiB free for $1, below $3=$2: backup refused"
  return 1
}

summary_value() { # json-file key: one scalar of restic's backup summary (no jq on the host)
  { grep '"message_type":"summary"' "$1" | tail -n 1 | grep -o "\"$2\":\"\{0,1\}[0-9a-f]*" | sed 's/.*:"\{0,1\}//'; } || true
}

stranded_file() { echo "$STATE_DIR/stranded-snapshots"; } # "<repo><TAB><snapshot id>" per partial snapshot left behind

snapshot_gone() { # repo id: the repository lists its snapshots and that one is not among them
  local list
  list="$(restic -r "$1" snapshots --json < /dev/null)" || return 1
  ! grep -q "\"id\":\"$2" <<< "$list"
}

# repo id: gone already, or forgotten now (restic 0.16 retries a full-length id that is missing for minutes: list first)
drop_snapshot() { snapshot_gone "$1" "$2" || restic -r "$1" forget "$2" < /dev/null; }

forget_partial() { # repo id: drop the snapshot a failed dump fed; if that fails, remember it so a later run retries
  local repo="$1" id="$2"
  [ -n "$id" ] || return 0
  restic -r "$repo" forget "$id" && return 0
  log "could not forget the partial snapshot $id in $repo: retried on every run, retention waits until it is gone"
  mkdir -p "$STATE_DIR"
  printf '%s\t%s\n' "$repo" "$id" >> "$(stranded_file)"
}

retry_stranded() { # repo: forget the partial snapshots earlier runs left in it; 1 while one is still there
  local file left=0 repo id
  file="$(stranded_file)"
  [ -s "$file" ] || return 0
  : > "$file.new"
  while IFS=$'\t' read -r repo id; do
    if [ "$repo" = "$1" ] && drop_snapshot "$repo" "$id"; then log "forgot the partial snapshot $id left in $repo"; continue; fi
    printf '%s\t%s\n' "$repo" "$id" >> "$file.new"
    [ "$repo" != "$1" ] || left=1
  done < "$file"
  mv "$file.new" "$file"
  [ -s "$file" ] || rm -f "$file"
  [ "$left" = 0 ] && return 0
  log "retention skipped for $1: a partial snapshot listed in $file is still there (restic -r <repo> forget <id>)"
  return 1
}

db_snapshot() { # repo producer...: stream the producer's archive into a new snapshot; a failed producer forgets it
  local repo="$1" json="$WORK/backup.json" restic_rc id tags=(--tag "$DB_TAG")
  shift
  [ "${MONGO_OPLOG:-1}" != 1 ] || tags+=(--tag "$OPLOG_TAG")
  set +e
  "$@" | restic -r "$repo" backup --stdin --stdin-filename "$ARCHIVE_NAME" "${tags[@]}" --json > "$json"
  DUMP_RC=${PIPESTATUS[0]} restic_rc=${PIPESTATUS[1]}
  set -e
  id="$(summary_value "$json" snapshot_id)"
  if [ "$DUMP_RC" -ne 0 ]; then
    log "database dump failed (exit $DUMP_RC) for $repo"
    forget_partial "$repo" "$id"
    return 1
  fi
  [ "$restic_rc" -eq 0 ] || { log "restic backup failed (exit $restic_rc) for $repo"; return 1; }
  log "database snapshot $id saved to $repo ($(summary_value "$json" data_added) new bytes)"
}

check_stamp() { echo "$STATE_DIR/checked-$(printf '%s' "$1" | sha256sum | cut -c1-16)"; } # repo

check_due() { [ -z "$(find "$(check_stamp "$1")" -mmin "-$CHECK_EVERY_MIN" 2> /dev/null)" ]; } # repo: no recent check

maintain() { # repo: retention per tag, prune, and the sampled integrity check when one is due
  local repo="$1" tag
  retry_stranded "$repo" || return 1 # a partial snapshot would count as the newest daily and age out a good one
  for tag in "$DB_TAG" "$FILES_TAG"; do
    restic -r "$repo" forget --tag "$tag" --group-by host "${KEEP[@]}" || return 1
  done
  restic -r "$repo" prune || return 1
  check_due "$repo" || return 0
  restic -r "$repo" check --read-data-subset "$CHECK_SUBSET" || return 1
  mkdir -p "$STATE_DIR" && touch "$(check_stamp "$repo")"
}

unlock_stale() { restic -r "$1" unlock > /dev/null 2>&1 || true; } # removes only the stale locks of a crashed run

run_step() { # name command...: a failed step is recorded and the next step still runs
  local name="$1"
  shift
  "$@" || FAILED+=("$name")
}

failed_steps() { (IFS=,; echo "${FAILED[*]}"); }
