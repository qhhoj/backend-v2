#!/usr/bin/env bash
# remote-deploy.sh <qhhoj-deploy args...>: runs the deploy helper on the production host as `deploy`.
# Exit 75 (deferred: contest or migration running) is retried every RETRY_INTERVAL s, RETRY_MAX times.
# With REGISTRY_TOKEN set, the helper gets --token-stdin and the token goes over ssh's stdin on every attempt, never argv.
set -uo pipefail
interval="${RETRY_INTERVAL:-600}" max="${RETRY_MAX:-36}"
run_once() { # <qhhoj-deploy args...>
  if [ -n "${REGISTRY_TOKEN:-}" ]; then
    printf '%s\n' "$REGISTRY_TOKEN" | ssh "deploy@${DEPLOY_HOST:?DEPLOY_HOST}" sudo /usr/local/sbin/qhhoj-deploy "$@" --token-stdin
  else
    ssh "deploy@${DEPLOY_HOST:?DEPLOY_HOST}" sudo /usr/local/sbin/qhhoj-deploy "$@"
  fi
}
for attempt in $(seq "$max"); do
  run_once "$@"
  code=$?
  [ "$code" = 75 ] || exit "$code"
  echo "deferred (attempt $attempt/$max); retrying in ${interval}s"
  sleep "$interval"
done
echo "still deferred after $max attempts" >&2
exit 75
