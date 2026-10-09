#!/usr/bin/env bash
# Stops exactly the processes recorded in $RUN/pids (start time must still match), then removes the run data.
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
[ -s "$PIDS" ] || { echo "no $PIDS: nothing to stop"; exit 0; }

still_ours() { [ -n "$3" ] && [ "$(start_time_of "$2")" = "$3" ]; }

# Reverse start order; a pid is signalled only if its start time still matches what we recorded.
# Each was started with setsid, so it leads its own group and -PID reaches its children.
signal_all() {
  local signal="$1" name pid started
  tac "$PIDS" | while read -r name pid started; do
    if still_ours "$name" "$pid" "$started"; then
      echo "stopping $name ($pid) with $signal"
      kill "-$signal" -- "-$pid" 2>/dev/null || kill "-$signal" "$pid" 2>/dev/null || true
    fi
  done
}

signal_all TERM
for _ in $(seq 1 20); do
  alive=0
  while read -r name pid started; do still_ours "$name" "$pid" "$started" && alive=1; done <"$PIDS"
  [ "$alive" = 0 ] && break
  sleep 0.5
done
signal_all KILL
rm -f "$PIDS"

if [ "${STACK_KEEP_DATA:-0}" != 1 ] && [ -e "$RUN_MARKER" ]; then
  rm -rf "$RUN"/{mongo,redis,media,problem-data,pdf,contest-data,user-data,control,dist} \
    "$RUN"/*.log "$RUN/env" "$RUN_MARKER"
  rmdir "$RUN" 2>/dev/null || true
fi
echo "stack stopped"
