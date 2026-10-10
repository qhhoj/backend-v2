#!/bin/sh
# Image entrypoint: runs one app of the backend image. APP selects it; arguments go to the app (migrator commands).
set -eu
umask 0027
case "${APP:-}" in
  api | bridge | worker | migrator) exec node "dist/apps/$APP/main" "$@" ;;
  *)
    echo "qhhoj-entrypoint: set APP to api, bridge, worker or migrator" >&2
    exit 64
    ;;
esac
