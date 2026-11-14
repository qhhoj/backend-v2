#!/usr/bin/env bash
# remote-deploy.sh <qhhoj-deploy args...>: runs the deploy helper on the production host as `deploy`.
# Exit 75 (deferred: contest or migration running) is retried RETRY_MAX times. The helper's message names the end of the
# contest ("retry after <ISO time>"): the retry comes SLACK s after that end (at most RETRY_INTERVAL s, at least SLACK s = 30)
# instead of up to a whole interval late; a deferral without an end time waits RETRY_INTERVAL s. The helper re-checks
# for a running contest on every attempt, so an early retry only defers again.
# With REGISTRY_TOKEN set, the helper gets --token-stdin and the token goes over ssh's stdin on every attempt, never argv.
set -uo pipefail
interval="${RETRY_INTERVAL:-600}" max="${RETRY_MAX:-36}" slack=30
out="$(mktemp)"; trap 'rm -f "$out"' EXIT
# Keepalives: the helper's index build can print nothing for many minutes, and an idle link must not drop it.
ssh_opts=(-o ServerAliveInterval=60 -o ServerAliveCountMax=10)
run_once() { # <qhhoj-deploy args...>
  if [ -n "${REGISTRY_TOKEN:-}" ]; then
    printf '%s\n' "$REGISTRY_TOKEN" | ssh "${ssh_opts[@]}" "deploy@${DEPLOY_HOST:?DEPLOY_HOST}" sudo /usr/local/sbin/qhhoj-deploy "$@" --token-stdin
  else
    ssh "${ssh_opts[@]}" "deploy@${DEPLOY_HOST:?DEPLOY_HOST}" sudo /usr/local/sbin/qhhoj-deploy "$@"
  fi
}
retry_delay() { # seconds to wait: until the contest named in the last output ends (+slack), within [slack, interval]
  local end delay
  end="$(sed -n 's/.*retry after \([0-9T:.Z-]*\).*/\1/p' "$out" | tail -1)"
  if [ -z "$end" ] || ! delay="$(date -d "$end" +%s 2>/dev/null)"; then echo "$interval"; return; fi
  delay=$(( delay - $(date +%s) + slack ))
  [ "$delay" -ge "$slack" ] || delay=$slack
  [ "$delay" -le "$interval" ] || delay=$interval
  echo "$delay"
}
for attempt in $(seq "$max"); do
  run_once "$@" | tee "$out"
  code=${PIPESTATUS[0]}
  [ "$code" = 75 ] || exit "$code"
  delay="$(retry_delay)"
  echo "deferred (attempt $attempt/$max); retrying in ${delay}s"
  sleep "$delay"
done
echo "still deferred after $max attempts" >&2
exit 75
