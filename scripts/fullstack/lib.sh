#!/usr/bin/env bash
# Shared by up.sh and down.sh. Sourced, not run.
RUN="${RUN:-/tmp/qhhoj-fullstack-${USER:-user}}"
PIDS="$RUN/pids"
RUN_MARKER="$RUN/.qhhoj-fullstack"
# 6379 and 6391 are the test redis instances that jest flushes.
FORBIDDEN_PORTS="4173 4310 4395 4396 4397 4398 4399 6379 6391"

# Field 22 of /proc/<pid>/stat: identifies the process even if the pid is reused.
start_time_of() {
  sed 's/.*) //' "/proc/$1/stat" 2>/dev/null | cut -d' ' -f20
}

assert_port_allowed() {
  for banned in $FORBIDDEN_PORTS; do
    if [ "$1" = "$banned" ]; then echo "port $1 is reserved, pick another" >&2; exit 1; fi
  done
}

port_is_listening() {
  ss -ltn "sport = :$1" | tail -n +2 | grep -q .
}

assert_port_free() {
  assert_port_allowed "$1"
  if port_is_listening "$1"; then
    echo "port $1 is already in use" >&2; exit 1
  fi
}

# start <name> <logfile> <command...>: runs detached in its own process group
# (so the recorded pid is the group leader), records "name pid starttime".
start() {
  local name="$1" log="$2"; shift 2
  setsid nohup "$@" >"$log" 2>&1 &
  local pid=$!
  echo "$name $pid $(start_time_of "$pid")" >>"$PIDS"
}

# wait_for <description> <command...>: polls up to 90 s.
wait_for() {
  local what="$1"; shift
  for _ in $(seq 1 180); do
    if "$@" >/dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  echo "timed out waiting for $what (see logs in $RUN)" >&2
  exit 1
}
