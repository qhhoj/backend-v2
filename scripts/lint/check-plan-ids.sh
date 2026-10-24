#!/usr/bin/env bash
# Fails when a source comment names a plan, task or preflight id ("sub-project 4", "Spec §3.8", "preflight M15",
# "Task 6", "2a"). Those ids mean nothing outside the planning documents; write the reason instead.
set -euo pipefail
cd "$(dirname "$0")/../.."
pattern='sub-project [0-9]|[Ss]pec §|preflight [A-Z][0-9]+|\(Task [0-9]+|core Task [0-9]+|\b(in|with) 2[ab]\b|\b2[ab]'"'"'s\b|\bplan [A-D]\b'
if grep -rnE --include='*.ts' "$pattern" apps libs; then
  echo "Plan, task or preflight ids found in comments (above): state the reason instead." >&2
  exit 1
fi
