#!/usr/bin/env bash
# Fails when a comment or doc names a plan, task or preflight id ("sub-project 4", "Spec §3.8", "preflight M15",
# "Task 6", "(3b)", "ruling C2", "2a"). Those ids mean nothing outside the planning documents; write the reason.
# Scans *.ts and *.md under apps, libs, scripts, docs and deploy, and *.yml under those and .github.
# docs/decisions.md is a dated log and is exempt.
set -euo pipefail
cd "$(dirname "$0")/../.."
pattern='sub-project [0-9]|[Ss]pec §|preflight [A-Z][0-9]+|\bTask [0-9]+|\([0-9][ab][ ,)]|ruling [A-Z][0-9]|\b(in|with) 2[ab]\b|\b2[ab]'"'"'s\b|\bplan [A-D]\b'
self=scripts/lint/check-plan-ids.sh
if grep -rnE --include='*.ts' --include='*.md' --include='*.yml' --exclude-dir=node_modules "$pattern" apps libs scripts docs deploy .github \
  | grep -v "^$self:" | grep -v '^docs/decisions.md:'; then
  echo "Plan, task or preflight ids found (above): state the reason instead." >&2
  exit 1
fi
