#!/bin/sh
# Image entrypoint: runs one app of the backend image. APP selects it; arguments go to the app.
set -eu
umask 0027
case "${APP:-}" in
  api | bridge | worker) exec node "dist/apps/$APP/main" "$@" ;;
  *)
    echo "qhhoj-entrypoint: set APP to api, bridge or worker" >&2
    exit 64
    ;;
esac
