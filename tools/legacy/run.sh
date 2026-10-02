#!/usr/bin/env bash
set -euo pipefail
C=${CONTAINER:-podman}
cd "$(dirname "$0")/../.."
$C network create qh-legacy >/dev/null 2>&1 || true
$C run -d --rm --name qh-legacy-db --network qh-legacy -e MARIADB_ROOT_PASSWORD=root -e MARIADB_DATABASE=legacy docker.io/library/mariadb:11 >/dev/null
trap '$C stop qh-legacy-db >/dev/null 2>&1; $C network rm qh-legacy >/dev/null 2>&1' EXIT
$C build -t qhhoj-legacy tools/legacy
for _ in $(seq 60); do $C exec qh-legacy-db healthcheck.sh --connect >/dev/null 2>&1 && break; sleep 1; done
$C exec qh-legacy-db healthcheck.sh --connect >/dev/null 2>&1 || { echo 'mariadb not ready after 60s' >&2; exit 1; }
# fixtures.py first: every django.setup() after seeding backfills a Profile for profile-less users (judge/apps.py ready())
$C run --rm --network qh-legacy -e DB_HOST=qh-legacy-db -v "$PWD/test/fixtures:/out:Z" qhhoj-legacy sh -c '
  python manage.py migrate --noinput &&
  python manage.py loaddata language_small &&
  python /tools/fixtures.py && python /tools/seed.py &&
  mysqldump -h qh-legacy-db -uroot -proot --skip-comments --skip-dump-date legacy > /out/legacy.sql'
