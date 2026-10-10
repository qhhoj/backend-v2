#!/usr/bin/env bash
# deploy/container/smoke.sh <image>: checks a built backend image. Needs docker, and Mongo (replica set rs0) and Redis on localhost.
set -euo pipefail
image="${1:?image}"
work="$(mktemp -d)"; trap 'docker rm -f qhhoj-smoke-api qhhoj-smoke-worker >/dev/null 2>&1 || true; rm -rf "$work"' EXIT

set +e; docker run --rm "$image" >/dev/null 2>&1; code=$?; set -e
[ "$code" = 64 ] || { echo "APP unset must exit 64, got $code" >&2; exit 1; }

docker run --rm --entrypoint sh "$image" -c '
  set -e
  [ "$(id -u):$(id -g)" = 991:991 ]
  pandoc --version | head -1 | grep -q "pandoc 3.1.3"
  prlimit --version >/dev/null
  node -e "require(\"playwright\").chromium.launch().then((b) => b.close())"
'

mkdir -p "$work/srv/media" "$work/srv/problem-data" "$work/srv/pdf-cache" "$work/srv/contest-data" "$work/srv/user-data"
chmod -R 777 "$work/srv"
cat > "$work/env" <<ENV
MONGO_URL=mongodb://127.0.0.1:27017/qhhoj_smoke?replicaSet=rs0
REDIS_URL=redis://127.0.0.1:6379/14
ENCRYPTION_KEY=$(openssl rand -hex 32)
TOKEN_SECRET=$(openssl rand -hex 32)
SITE_URL=http://localhost
LISTEN_HOST=127.0.0.1
PORT=3999
TRUST_PROXY=loopback
COOKIE_SECURE=false
MEDIA_ROOT=/srv/qhhoj/media
MEDIA_URL=/media
PROBLEM_DATA_ROOT=/srv/qhhoj/problem-data
PDF_CACHE_ROOT=/srv/qhhoj/pdf-cache
CONTEST_DATA_ROOT=/srv/qhhoj/contest-data
USER_DATA_ROOT=/srv/qhhoj/user-data
ENV
run_app() { docker run -d --name "qhhoj-smoke-$1" --network host --env-file "$work/env" -e "APP=$1" -v "$work/srv:/srv/qhhoj" "$image" >/dev/null; }

run_app api
for _ in $(seq 60); do curl -fsS http://127.0.0.1:3999/api/internal/site >/dev/null 2>&1 && break; sleep 1; done
curl -fsS http://127.0.0.1:3999/api/internal/site >/dev/null || { docker logs qhhoj-smoke-api; exit 1; }

run_app worker
sleep 15
[ "$(docker inspect -f '{{.State.Running}}' qhhoj-smoke-worker)" = true ] || { docker logs qhhoj-smoke-worker; exit 1; }
echo "image ok"
