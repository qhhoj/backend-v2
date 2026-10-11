#!/usr/bin/env bash
# deploy/quadlet/quadlet.test.sh: the quadlet generator accepts the three units and they carry the runtime contract.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
generator="${QUADLET:-/usr/libexec/podman/quadlet}"
out="$(QUADLET_UNIT_DIRS="$here" "$generator" -dryrun 2>&1)" || { echo "$out" >&2; exit 1; }

section() { awk -v unit="---$1.service---" '$0 == unit {on = 1; next} /^---.*---$/ {on = 0} on' <<<"$out"; }
expect() { # <unit> <pattern>
  section "$1" | grep -qE -- "$2" || { echo "$1: missing $2" >&2; section "$1" >&2; exit 1; }
}

for unit in qhhoj-api qhhoj-bridge qhhoj-worker; do
  expect "$unit" '--network[= ]host'
  expect "$unit" '--user[= ]987:987'
  expect "$unit" '--read-only'
  expect "$unit" 'ghcr.io/qhhoj/backend-v2:current'
  expect "$unit" '--env-file /etc/qhhoj/env'
  expect "$unit" "APP=${unit#qhhoj-}"
  expect "$unit" '^PartOf=qhhoj.target'
done
expect qhhoj-bridge '/srv/qhhoj/problem-data:/srv/qhhoj/problem-data:ro'
expect qhhoj-bridge '/etc/qhhoj/bridge-tls:/etc/qhhoj/bridge-tls:ro'
expect qhhoj-bridge '/srv/qhhoj/media:/srv/qhhoj/media:ro'
expect qhhoj-api '/srv/qhhoj:/srv/qhhoj'
expect qhhoj-worker '^MemoryMax=5G'
expect qhhoj-worker '--shm-size=1g'
echo "quadlets ok"
