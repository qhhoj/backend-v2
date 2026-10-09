#!/usr/bin/env bash
# Starts mongod, redis, api, worker, bridge, an optional gRPC fake judge and vite preview on private ports.
# Env: RUN FRONTEND_DIR MONGOD_BIN STACK_SKIP_REDIS=1 (use REDIS_URL) STACK_JUDGE=fake|none
#      PORT_MONGO PORT_REDIS PORT_API PORT_BRIDGE PORT_PREVIEW
set -euo pipefail
BACKEND="$(cd "$(dirname "$0")/../.." && pwd)"
source "$BACKEND/scripts/fullstack/lib.sh"
FRONTEND_DIR="${FRONTEND_DIR:-$BACKEND/../frontend-v2}"
[ -d "$FRONTEND_DIR" ] || { echo "frontend not found at $FRONTEND_DIR: set FRONTEND_DIR" >&2; exit 1; }
FRONTEND="$(cd "$FRONTEND_DIR" && pwd)"
PORT_MONGO="${PORT_MONGO:-27018}"; PORT_REDIS="${PORT_REDIS:-6390}"
PORT_API="${PORT_API:-3110}"; PORT_BRIDGE="${PORT_BRIDGE:-9990}"; PORT_PREVIEW="${PORT_PREVIEW:-4320}"
STACK_JUDGE="${STACK_JUDGE:-fake}"

case "$STACK_JUDGE" in fake | none) ;; *) echo "STACK_JUDGE must be fake or none" >&2; exit 1 ;; esac
if [ -s "$PIDS" ]; then echo "a stack is recorded in $PIDS; run npm run stack:down first" >&2; exit 1; fi
for port in "$PORT_MONGO" "$PORT_API" "$PORT_BRIDGE" "$PORT_PREVIEW"; do assert_port_free "$port"; done
if [ "${STACK_SKIP_REDIS:-0}" = 1 ]; then
  [ -n "${REDIS_URL:-}" ] || { echo "STACK_SKIP_REDIS=1 needs REDIS_URL" >&2; exit 1; }
  assert_port_allowed "$(echo "$REDIS_URL" | sed -E 's|^[a-z]+://[^/]*:([0-9]+)(/.*)?$|\1|')"
else
  assert_port_free "$PORT_REDIS"
  command -v redis-server >/dev/null || { echo "no redis-server on PATH: install redis, or set STACK_SKIP_REDIS=1 and REDIS_URL to a throwaway redis" >&2; exit 1; }
fi

find_mongod() {
  [ -n "${MONGOD_BIN:-}" ] && { echo "$MONGOD_BIN"; return; }
  { ls -1 "$HOME"/.cache/mongodb-binaries/mongod-* "$BACKEND"/node_modules/.cache/mongodb-memory-server/mongod-* 2>/dev/null || true; } \
    | awk -F/ '{print $NF, $0}' | sort -V | tail -n 1 | cut -d' ' -f2-
}
MONGOD="$(find_mongod)"
[ -x "${MONGOD:-}" ] || { echo "no mongod binary: set MONGOD_BIN (cached ones live in ~/.cache/mongodb-binaries)" >&2; exit 1; }

mkdir -p "$RUN"/{mongo,redis,media,problem-data,pdf,contest-data,user-data,control}
touch "$RUN_MARKER"
trap '[ $? -eq 0 ] || echo "stack failed to start; logs are in $RUN; run npm run stack:down to clean up" >&2' EXIT

# Generated once per $RUN: a kept data dir needs the same keys and passwords on the next up.
if [ ! -s "$RUN/env" ]; then
  cat >"$RUN/env" <<ENV
export NODE_ENV=development
export MONGO_URL='mongodb://127.0.0.1:$PORT_MONGO/qhhoj_e2e_real?replicaSet=rs0&directConnection=true'
export REDIS_URL='${REDIS_URL:-redis://127.0.0.1:$PORT_REDIS}'
export ENCRYPTION_KEY=$(openssl rand -hex 32)
export TOKEN_SECRET=$(openssl rand -hex 32)
export SITE_URL=http://127.0.0.1:$PORT_PREVIEW
export COOKIE_SECURE=false
export PORT=$PORT_API
export JUDGE_BRIDGE_HOST=127.0.0.1
export JUDGE_BRIDGE_PORT=$PORT_BRIDGE
export MEDIA_ROOT=$RUN/media
export PROBLEM_DATA_ROOT=$RUN/problem-data
export PDF_CACHE_ROOT=$RUN/pdf
export CONTEST_DATA_ROOT=$RUN/contest-data
export USER_DATA_ROOT=$RUN/user-data
export E2E_PORT=$PORT_PREVIEW
export E2E_REAL_API=http://127.0.0.1:$PORT_API
export E2E_ADMIN_PASSWORD=$(openssl rand -hex 12)
export E2E_USER_PASSWORD=$(openssl rand -hex 12)
export FAKE_JUDGE_KEY=$(openssl rand -hex 12)
export FULLSTACK_CONTROL_DIR=$RUN/control
export FAKE_JUDGE_SOURCE_WA='# fake-judge:WA'
ENV
fi
set -a; source "$RUN/env"; set +a

start mongod "$RUN/mongod.log" "$MONGOD" --replSet rs0 --bind_ip 127.0.0.1 --port "$PORT_MONGO" --dbpath "$RUN/mongo"
wait_for mongod node "$BACKEND/scripts/fullstack/init-replset.js" "$PORT_MONGO"

if [ "${STACK_SKIP_REDIS:-0}" != 1 ]; then
  start redis "$RUN/redis.log" redis-server --port "$PORT_REDIS" --bind 127.0.0.1 --save "" --appendonly no --dir "$RUN/redis"
  wait_for redis redis-cli -p "$PORT_REDIS" ping
fi

cd "$BACKEND"
capped 3G npx nest build api && capped 3G npx nest build worker && capped 3G npx nest build bridge
capped 2G npm run seed:e2e

start api "$RUN/api.log" node dist/apps/api/main
start worker "$RUN/worker.log" node dist/apps/worker/main
start bridge "$RUN/bridge.log" node dist/apps/bridge/main
wait_for api curl -sf "http://127.0.0.1:$PORT_API/api/internal/problems/meta"
wait_for "bridge port $PORT_BRIDGE" bash -c "ss -ltn 'sport = :$PORT_BRIDGE' | tail -n +2 | grep -q ."

if [ "$STACK_JUDGE" = fake ]; then
  start judge "$RUN/judge.log" node -r ts-node/register/transpile-only -r tsconfig-paths/register apps/bridge/test/fake-judge-cli.ts
  wait_for "judge online" grep -q "judge online" "$RUN/judge.log"
fi

# The bundle goes to $RUN/dist so a checkout's own dist/ is never touched.
cd "$FRONTEND"
API_ORIGIN="$E2E_REAL_API" capped 3G npx vite build --outDir "$RUN/dist" --emptyOutDir
start preview "$RUN/preview.log" env API_ORIGIN="$E2E_REAL_API" node node_modules/vite/bin/vite.js preview --outDir "$RUN/dist" --host 127.0.0.1 --port "$PORT_PREVIEW" --strictPort
wait_for preview curl -sf "http://127.0.0.1:$PORT_PREVIEW/api/internal/problems/meta"

echo "RUN=$RUN"
echo "stack is up (judge: $STACK_JUDGE); run: source $RUN/env && (cd $FRONTEND && npx playwright test --project=real-backend --workers=1)"
