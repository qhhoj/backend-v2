# Production runbook

Config only: nothing here has been deployed. Files: `nginx/qhhoj.conf`, `nginx/security-headers.conf`, `systemd/*`, `env.production.example`.
Layout assumed: code in `/opt/qhhoj/backend`, frontend dist in `/var/www/qhhoj`, data under `/srv/qhhoj`, env in `/etc/qhhoj/env`, user `qhhoj`.

## Prerequisites

- Node (the CI version), nginx, MongoDB 8 as a replica set `rs0` with auth, Redis >= 7.
- Worker: pandoc >= 3 (static release, not apt), `prlimit` (util-linux), Chromium, `python3 make g++` for `npm ci`; about 2 GB per PDF job plus 2 GiB for similarity.
- Disk: `MEDIA_ROOT`, `PROBLEM_DATA_ROOT`, `PDF_CACHE_ROOT`, `CONTEST_DATA_ROOT`, `USER_DATA_ROOT` as separate directories owned by `qhhoj` (none under `MEDIA_ROOT`).
- TLS certificate for the site host; firewall that allows 80/443 publicly and `JUDGE_BRIDGE_PORT` from judge hosts only.
- Read access to the legacy MariaDB and its Django `SECRET_KEY`.

## First install

1. `git clone` backend-v2 to `/opt/qhhoj/backend`, `npm ci`, `npm run build` (builds api, bridge, worker, migrator into `dist/apps/*`).
2. Frontend: `npm ci && npm run build` in frontend-v2, copy `dist/` to `/var/www/qhhoj`.
3. `install -m 600 -o qhhoj deploy/env.production.example /etc/qhhoj/env`; fill `ENCRYPTION_KEY`, `TOKEN_SECRET` (`openssl rand -hex 32`), URLs, `SITE_URL`.
4. nginx: copy `deploy/nginx/qhhoj.conf` to `conf.d/`, `security-headers.conf` to `snippets/qhhoj-security-headers.conf`; set the `CHANGE` lines (host, certificate, `root`, media paths); `nginx -t && systemctl reload nginx`.
5. systemd: `cp deploy/systemd/* /etc/systemd/system/ && systemctl daemon-reload && systemctl enable qhhoj.target`. Do not start yet.
6. Build the indexes before serving (the `.hint()` queries throw without them): run the migration below (it syncs indexes) or `syncIndexes` on an empty database.

## Migration run

Run on the new host with `LEGACY_MYSQL_URL`, `LEGACY_SECRET_KEY` and `MONGO_URL` exported (see `CONTRIBUTING.md`, "Backfill jobs").

- Ahead of cutover, while the old site is live: `node dist/apps/migrator/main backfill` (idempotent upsert by `_id`; add `--fresh` only on a rehearsal). Repeat to catch up.
- `node dist/apps/migrator/main verify` must exit 0; exit 1 lists mismatches.
- Copy the legacy upload tree into `MEDIA_ROOT` (including `submission_file/`) and the problem data into `PROBLEM_DATA_ROOT`; rsync again in the window.
- Rehearse the whole sequence on a copy first and time the final backfill: that time is the length of the read-only window.

## Cutover sequence

1. Announce. Lower the DNS TTL a day ahead.
2. Old site read-only: put the old nginx in a mode that rejects POST/PUT/PATCH/DELETE (503 with a notice), stop the old judges' intake, wait for in-flight submissions to finish.
3. Final `backfill`, `rsync` media and problem data, then `verify` (exit 0 required; otherwise abort, the old site is untouched).
4. Start the new stack: `systemctl start qhhoj.target`, then run the smoke checks against the new host by `curl --resolve` or `/etc/hosts`.
5. Point the judges to the new bridge (see Judge connection) and check they connect.
6. Switch DNS to the new host. All sessions are invalidated once, users log in again.
7. Watch `journalctl -u 'qhhoj-*' -f` and the judge list for 30 minutes. Keep the old site and its database untouched, read-only, for the rollback period.

## Smoke checks

- `curl -fsS https://HOST/api/internal/site` returns JSON; `curl -I https://HOST/some/spa/route` returns 200 with the HTML shell.
- `curl -N https://HOST/api/internal/events/...` as a logged-in user prints a heartbeat within 15 s without delay (proves unbuffered).
- Log in, open a problem, submit a solution; a judge grades it; the verdict appears live.
- A statement PDF renders (worker + Chromium + pandoc); an uploaded image shows from `/media/`.
- `ss -ltn | grep 9999` is open locally but unreachable from outside the judge network; `systemctl status qhhoj-*` all active.
- Registration works only after `mail.smtpUrl` is set (admin settings, `judge.change_settings`).

## Backup

- Mongo: `mongodump --uri "$MONGO_URL" --gzip --archive=/backup/qhhoj-$(date +%F).gz` nightly; restore with `mongorestore --gzip --archive=... --drop`. Test a restore once.
- Data roots: `rsync -a --delete` (or restic) of `MEDIA_ROOT` and `PROBLEM_DATA_ROOT` nightly; `PDF_CACHE_ROOT`, `CONTEST_DATA_ROOT` and `USER_DATA_ROOT` are regenerable and need no backup.
- Redis holds no durable state (queue truth is Mongo); no backup needed.

## Rollback

- Before DNS switch: `systemctl stop qhhoj.target`, reopen the old site (remove the read-only rule), repoint the judges. Nothing was lost.
- After DNS switch: new-site writes exist only in Mongo. Decide quickly: either accept the loss and switch DNS back to the old site (and its judges), or fix forward. There is no reverse migration; submissions made on the new site are not replayed to the old one.
- Keep the old database and uploads unmodified until the rollback period (suggest 2 weeks) ends.

## Judge connection

- Judges (qhhoj/judge-server fork, which handles UUID submission ids) connect to `BRIDGE_HOST:JUDGE_BRIDGE_PORT` (default 9999) with their judge name and key.
- Create or rotate the judge and its key in the admin UI (the key is shown once; a rotate or block disconnects the judge at once). Migrated judges keep their names; issue new keys.
- Only one bridge instance may run. Bind `JUDGE_BRIDGE_HOST` to the private interface where possible and firewall the port to judge hosts; nginx never proxies it.
- Judges must reach `SITE_URL` + `MEDIA_URL` over HTTP(S) (file-only submissions), share the `PROBLEM_DATA_ROOT` volume, and run with a restart policy (they exit on a broken connection).
