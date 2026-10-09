# Production runbook

Config only: nothing here has been deployed. Files: `nginx/qhhoj.conf`, `nginx/security-headers.conf`, `systemd/*`, `env.production.example`.
Layout assumed: code in `/opt/qhhoj/backend`, frontend dist in `/var/www/qhhoj`, data under `/srv/qhhoj`, env in `/etc/qhhoj/env`, user `qhhoj`.

## Prerequisites

- Node 22 at `/usr/bin/node` (NodeSource, not nvm), nginx >= 1.25.1 (nginx.org repo; older: `listen 443 ssl http2;`), MongoDB 8 as a replica set `rs0` with auth, Redis >= 7.
- Worker: pandoc >= 3 (static release, not apt), `prlimit` (util-linux), Chromium, `python3 make g++` for `npm ci`; about 2 GB per PDF job plus 2 GiB for similarity.
- Disk: `MEDIA_ROOT`, `PROBLEM_DATA_ROOT`, `PDF_CACHE_ROOT`, `CONTEST_DATA_ROOT`, `USER_DATA_ROOT` as separate directories owned by `qhhoj` (none under `MEDIA_ROOT`).
- TLS certificate for the site host; firewall: 80/443 public; `PORT` (3000) closed to everything but loopback (the api also binds 127.0.0.1 via `LISTEN_HOST`); `JUDGE_BRIDGE_PORT` from judge hosts only.
- Read access to the legacy MariaDB and its Django `SECRET_KEY`.

## First install

0. `useradd --system --home-dir /var/lib/qhhoj --create-home --shell /usr/sbin/nologin qhhoj; install -d -o qhhoj -g qhhoj -m 2750 /srv/qhhoj /srv/qhhoj/{media,problem-data,pdf-cache,contest-data,user-data}; usermod -aG qhhoj www-data` (`nginx` on nginx.org packages), then restart nginx. The units' `UMask=0027` keeps new files group-readable and setgid keeps the group; nginx reads `/media/` through that group (without it every `/media/` request is 403, including judge fetches of file-only submissions). Judges sharing `PROBLEM_DATA_ROOT` on this host need the same group membership or a read mount. For the legacy rsync use `--chown=qhhoj:qhhoj --chmod=D2750,F640`.
1. `git clone` backend-v2 to `/opt/qhhoj/backend`, `npm ci`, `npm run build` (builds api, bridge, worker, migrator into `dist/apps/*`), then `chown -R root:root /opt/qhhoj/backend` (the units mount it read-only). Chromium for the worker: `npx playwright install-deps chromium` (root), then `sudo -u qhhoj -H npx playwright install chromium`.
2. Frontend: `npm ci && npm run build` in frontend-v2, copy `dist/` to `/var/www/qhhoj`.
3. `install -d -m 700 /etc/qhhoj && install -m 600 -o root -g root deploy/env.production.example /etc/qhhoj/env`; fill `ENCRYPTION_KEY`, `TOKEN_SECRET` (`openssl rand -hex 32`), URLs, `SITE_URL`.
4. nginx: copy `deploy/nginx/qhhoj.conf` to `conf.d/`, `security-headers.conf` to `snippets/qhhoj-security-headers.conf`; set the `CHANGE` lines (host, certificate, `root`, media paths); `nginx -t && systemctl reload nginx`.
5. systemd: `cp deploy/systemd/* /etc/systemd/system/ && systemctl daemon-reload && systemctl enable qhhoj.target`. Do not start yet.
6. Build the indexes before serving (the `.hint()` queries throw without them): run the migration below (it syncs indexes) or `syncIndexes` on an empty database.

## Migration run

Run on the new host with the variables below in `/root/migrate.env` (mode 600; `set -a; . /root/migrate.env; set +a`; delete it after the rollback period). The migrator reads `process.env` directly; a command that lacks a variable fails with `<NAME> is required`.

| Variable                              | Needed by                                                                   |
| ------------------------------------- | --------------------------------------------------------------------------- |
| `MONGO_URL`                           | every command                                                               |
| `LEGACY_MYSQL_URL`                    | audit, backfill, verify, check-integrity                                    |
| `LEGACY_SECRET_KEY`, `ENCRYPTION_KEY` | backfill and verify (users job: decrypts legacy 2FA secrets, re-seals them) |
| `MEDIA_URL` (default `/media`)        | backfill and verify (problems, sources), check-files                        |
| `REDIS_URL`                           | recompute (same Redis and Mongo as the worker)                              |
| `PROBLEM_DATA_ROOT`, `MEDIA_ROOT`     | check-files                                                                 |

`/etc/qhhoj/env` and `/root/migrate.env` must hold the same `MONGO_URL`, `REDIS_URL`, `ENCRYPTION_KEY` and `MEDIA_URL`. A different `ENCRYPTION_KEY` seals every migrated TOTP secret and scratch code under a key the api does not hold, and `verify` cannot see it (it opens them with the migrate key): every 2FA user would be locked out. Compare the values before the first `backfill`.

For a rehearsal on the full dump run the migrator as `NODE_OPTIONS=--max-old-space-size=3072` inside a 4 GB limit. A rehearsal without the legacy `SECRET_KEY` may run `backfill` and `verify` with `--skip-legacy-secrets` under `MIGRATION_REHEARSAL=1` (refused otherwise): no `LEGACY_SECRET_KEY` or `ENCRYPTION_KEY`, the canary is skipped, every user migrates with 2FA off (counted as `2FA off (legacy secrets skipped, rehearsal)`). The real cutover must never set `MIGRATION_REHEARSAL` or pass that flag: it would lock 2FA off for every account. Time `audit` too: its zero-date scan reads every date column, including the 13M-row activity table.

Data dirs (`MEDIA_ROOT`, `PROBLEM_DATA_ROOT`, and any MariaDB or Mongo datadir used in a rehearsal) must not be under `/tmp`: it is a size-limited tmpfs and a 4.5 GB import fills it ("table is full").

Order (all from `node dist/apps/migrator/main <command>`):

1. `audit` (read-only). Read its warnings; the manual items below come from it.
2. `backfill [jobs...] [--fresh] [--report <path>]`: idempotent upsert by `_id`, repeatable while the old site is live (delta catch-up). It writes the migration marker the worker requires. `--fresh` empties each selected collection first (rehearsal, and the final run so rows deleted on the old site disappear; ids stay stable through `migrationIdMap`). Without `--fresh` a replaced row under a unique key (misc config key, flatpage url) is refused as a duplicate, so delta runs are a warm-up only; the final run is always `--fresh`. The console shows a few lines per job; every report line (ids, codes and keys only, no row data) is saved to `--report` (default `./migration-report-<time>.txt`, mode 600) and its path is printed. The manual items below are read from that file. Never run `backfill` against the live database after `finish`: it re-arms the marker and with it the rating wipe.
3. `verify [jobs...]` must exit 0; exit 1 lists mismatches (job and document).
4. Start only the worker (`systemctl start qhhoj-worker`; the api and bridge stay stopped), then `recompute`: the worker's `migration-recompute` job (points, stats, scores, caches; re-rates every rated contest, see decisions.md). It needs a running worker on the same Redis and Mongo and fails at once with "no worker on migration-recompute" otherwise. It detects the worker with Redis `CLIENT LIST`; a managed Redis that forbids it needs a self-hosted one. Allow hours (6 h timeout). The worker may stay up afterwards or be stopped; `qhhoj.target` starts it in step 4 of the cutover anyway.
5. Copy the legacy upload tree into `MEDIA_ROOT` (including `submission_file/`) and the problem data into `PROBLEM_DATA_ROOT`; rsync again in the window. Audit the media tree: `find $MEDIA_ROOT -type f ! -path '*/submission_file/*' | sed 's/.*\.//' | sort | uniq -c`; nginx serves only png/jpg/jpeg/gif/webp/svg/pdf/txt inline and everything else as a download.
6. `check-files` (exit 1 lists missing files, first 50 shown) and `check-integrity` (references, counts, rating coverage; exit 1 on a problem) must exit 0, except as ruled below. `check-files` also warns about `pdfStatementUrl`/`materialUrl` site paths outside `MEDIA_URL` (they cannot be checked here): open each by hand on the new host.

   Rating coverage ("legacy-rated participations without a v2 rating", "v2 ratings without a legacy rating", "rated contests: legacy N, v2 M") can differ legitimately because the replay re-rates (users cross the rating floor and ceiling; contests legacy marked rated but never rated get rows). Any other line (references, "submissions scoring above their problem's points", stale user ratings) is still an abort. For a rating shortfall: read the per-contest breakdown; a handful of contests with few missing rows is accepted and recorded in the decisions log; a shortfall spread over many contests, or any contest missing most of its rows, means the replay did not run: abort, re-run `recompute`, and check the worker log.

7. `finish`: clears the migration marker, so the worker refuses `migration-recompute` from then on. Run it before go-live and never after the site takes writes.
8. `mongodump` the migrated database (`/backup/qhhoj-cutover.gz`) before starting the services.

Rehearse the whole sequence on a copy first and time `backfill --fresh`: that is the length of the read-only window. Drop `migrationIdMap` once if a rehearsal ran older migrator code (`db.migrationIdMap.drop()`); production starts empty.

Manual items:

- Deactivated superusers. Old-site admin-deactivated accounts migrate banned ("Account deactivated on the old site.", inactive, unlisted). Staff cannot unban a superuser in the UI. The audit warning "auth_user deactivated superusers" gives the count. Leave them banned: they could not log in on the old site either. Re-enable one only on an explicit decision that the person regains access (`db.users.updateOne({ username: "<name>" }, { $set: { isActive: true, banReason: null, isUnlisted: false } })` restores full superuser access, a grant the old site did not give). To let staff manage the account instead, demote it: `$set: { isSuperuser: false, isStaff: false }`.
- Lua label scripts: 6 contests use one; v2 has only numeric and alpha labels, so they become alpha and the report says `judge_contest:<id> Lua label script -> alpha`. Staff open each of the 6 and check the problem labels.
- Clamped points: 19 problems had points outside 800..3500 and were clamped (`clamped points judge_problem:<id> <old> -> <new>` in the report). The submissions job rescored those problems' graded submissions against the clamped points, so their user points and stats stay consistent. Review the new points with the problem setters; if one changes, a `problem-rescore` fixes its submissions.
- RJ test cases: case status `RJ` is not a v2 status; those cases are dropped and counted in the report (submission totals are unaffected).
- Judges are not migrated (names fail the v2 pattern and judge-v2 registers fresh): create judges and keys in the admin UI after cutover.
- Canary skip: the users job checks `LEGACY_SECRET_KEY` against the first `totp_key`, else the first `scratch_codes`. With neither it logs "no legacy secret to test LEGACY_SECRET_KEY against (canary skipped)": check the key by hand then. A wrong key aborts the users job.
- Not migrated, tell the users: API tokens (`judge_profile.api_token`; regenerate them) and IP auth.
- Template-valued misc config entries are kept raw and only reported: convert them by hand. Re-enter the legacy site settings (the env/settings import is paused) in the admin UI.
- Permissions that exist only in v2 (for example `judge.change_settings`, `judge.import_polygon_package`, `judge.create_mass_testcases`) are held by no migrated group. Superusers bypass them; grant them to the staff groups that need them.
- Badges, legacy ratings, activity, sessions and logs are not migrated by decision; users log in again.

## Cutover sequence

1. Announce. Lower the DNS TTL a day ahead.
2. Old site read-only: put the old nginx in a mode that rejects POST/PUT/PATCH/DELETE (503 with a notice), stop the old site's background workers (celery, cron) and the old judges' intake, wait for in-flight submissions to finish.
3. Final `backfill --fresh` (the id map is kept, so ids stay stable; rows deleted since an earlier run would otherwise fail `verify`), `rsync` media and problem data, then `verify`, start the worker alone (`systemctl start qhhoj-worker`) and `recompute`, then `check-files`, `check-integrity` (all exit 0 required; otherwise abort, the old site is untouched) and `finish`.
4. Start the new stack: `systemctl start qhhoj.target`, then run the smoke checks against the new host by `curl --resolve` or `/etc/hosts`.
5. Point the judges to the new bridge (see Judge connection) and check they connect.
6. Switch DNS to the new host. All sessions are invalidated once, users log in again.
7. Watch `journalctl -u 'qhhoj-*' -f` and the judge list for 30 minutes. Keep the old site and its database untouched, read-only, for the rollback period. HSTS ships at `max-age=300` for that period; afterwards raise it to `31536000` in `nginx/security-headers.conf`. The SPA CSP ships as Report-Only: after a few clean days rename it to `Content-Security-Policy`.

## Smoke checks

- `curl -fsS https://HOST/api/internal/site` returns JSON; `curl -I https://HOST/some/spa/route` returns 200 with the HTML shell.
- `curl -N https://HOST/api/internal/events/...` as a logged-in user prints a heartbeat within 15 s without delay (proves unbuffered).
- Log in, open a problem, submit a solution; a judge grades it; the verdict appears live.
- A statement PDF renders (worker + Chromium + pandoc); an uploaded image shows from `/media/`.
- `ss -ltn | grep 9999` is open locally but unreachable from outside the judge network; `systemctl status qhhoj-*` all active.
- Registration works only after `mail.smtpUrl` is set (admin settings, `judge.change_settings`).

## Backup

- Secrets: keep `/etc/qhhoj/env` (at least `ENCRYPTION_KEY`, `TOKEN_SECRET`) in an offline secret store, separate from the dumps; encrypted settings and 2FA secrets in a dump are useless without the same `ENCRYPTION_KEY`.
- Mongo: `mongodump --uri "$MONGO_URL" --gzip --archive=/backup/qhhoj-$(date +%F).gz` nightly (no `--oplog`: not point-in-time, acceptable nightly); restore with `mongorestore --gzip --archive=... --drop`. Test a restore once.
- Data roots: restic (or dated snapshots, not a `--delete` mirror) of `MEDIA_ROOT` and `PROBLEM_DATA_ROOT` nightly, right after the mongodump; `PDF_CACHE_ROOT`, `CONTEST_DATA_ROOT` and `USER_DATA_ROOT` are regenerable and need no backup.
- Redis holds no durable state (queue truth is Mongo); no backup needed.

## Rollback

- Before DNS switch: `systemctl stop qhhoj.target`, reopen the old site (remove the read-only rule), repoint the judges with their old build and config (keep both). Nothing was lost.
- After DNS switch: new-site writes exist only in Mongo. Decide quickly: either accept the loss and switch DNS back to the old site (and its judges), or fix forward. There is no reverse migration; submissions made on the new site are not replayed to the old one.
- Keep the old database and uploads unmodified until the rollback period (suggest 2 weeks) ends.

## Judge connection

- Judges (qhhoj/judge-server fork, which handles UUID submission ids) connect to `BRIDGE_HOST:JUDGE_BRIDGE_PORT` (default 9999) with their judge name and key.
- Create or rotate the judge and its key in the admin UI (the key is shown once; a rotate or block disconnects the judge at once). Judges are not migrated; register them fresh and issue new keys.
- Only one bridge instance may run. Bind `JUDGE_BRIDGE_HOST` to the private interface where possible and firewall the port to judge hosts; nginx never proxies it.
- Remote judges connect only over a private network or WireGuard (keys travel in clear). `/api/internal/openapi.json` is public and lists admin routes (all permission-guarded); deny it in nginx if unwanted. Judges must reach `SITE_URL` + `MEDIA_URL` over HTTP(S) (file-only submissions), share the `PROBLEM_DATA_ROOT` volume, and run with a restart policy (they exit on a broken connection).
