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

0. `useradd --system --home-dir /var/lib/qhhoj --create-home --shell /usr/sbin/nologin qhhoj; install -d -o qhhoj -g qhhoj -m 2750 /srv/qhhoj /srv/qhhoj/{media,problem-data,pdf-cache,contest-data,user-data}; usermod -aG qhhoj www-data` (`nginx` on nginx.org packages), then restart nginx. The units' `UMask=0027` keeps new files group-readable and setgid keeps the group; nginx reads `/media/` through that group (without it every `/media/` request is 403). Judges sharing `PROBLEM_DATA_ROOT` on this host need the same group membership or a read mount. For the legacy rsync use `--chown=qhhoj:qhhoj --chmod=D2750,F640`.
1. `git clone` backend-v2 to `/opt/qhhoj/backend`, `npm ci`, `npm run build && for app in bridge worker migrator; do npx nest build $app; done` (`npm run build` alone builds only the api; together they fill `dist/apps/*`), then `chown -R root:root /opt/qhhoj/backend` (the units mount it read-only). Chromium for the worker: `npx playwright install-deps chromium` (root), then `sudo -u qhhoj -H npx playwright install chromium`.
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
   2a. `grant-permissions`: gives each v2-only permission to the groups and users holding its anchor (`judge.change_contest_tag` ← `judge.edit_all_contest`, `judge.delete_problem` ← `judge.edit_all_problem`, `judge.manage_short_link` ← `flatpages.change_flatpage`, `judge.manage_integration` ← `judge.change_miscconfig`; groups and users holding the anchor directly both get the codename; the full list is `apps/migrator/src/permission-grants.ts`) (idempotent, rerun after every `backfill --fresh`, which rewrites `groups` from the legacy rows). Run it after the final `backfill --fresh`. `verify` ignores the codenames it adds, so step 3 passes whether or not it ran.
   2b. Reserved problem codes: before deploying the problem lifecycle, `db.problems.countDocuments({ code: { $in: ['deleted', 'meta', 'imports'] } })` must be 0; a problem with such a code is already shadowed by the static routes and an administrator must rename it first.
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
- Permissions that exist only in v2 (for example `judge.change_settings`, `judge.import_polygon_package`, `judge.create_mass_testcases`) are held by no migrated group, except those `grant-permissions` derives from an anchor permission (see `apps/migrator/src/permission-grants.ts`, e.g. `judge.change_contest_tag`, `judge.delete_problem`). Superusers bypass them; grant them to the staff groups that need them.
- Badges, legacy ratings, activity, sessions and logs are not migrated by decision; users log in again.

## Cutover sequence

Before the window (days ahead): judge hosts provisioned and verified ("Judge hosts", steps 1-10 except starting the unit); the judge-v2 release unpacked and `selftest` clean on every host; the parity run (`scripts/judge/parity/README.md`) without unclassified differences on this release; `stamp-data-versions --dry-run` rehearsed on the rehearsal copy; `count-data-shapes` exits 0 on the rehearsal copy (a Pascal or Java bridged checker needs a testlib judge-v2 does not ship: convert it to C++ first) and `prune-languages --keep "$DAY_ONE_LANGUAGES,OUTPUT" --dry-run` rehearsed there (`unknownKeep` must be empty; announce `prunedLanguages` and `problemsChanged` to problem setters). On judge hosts the old DMOJ judge stays installed but will be stopped: keep its config and unit for the rollback period.

1. Announce. Lower the DNS TTL a day ahead.
2. Old site read-only: put the old nginx in a mode that rejects POST/PUT/PATCH/DELETE (503 with a notice), stop the old site's background workers (celery, cron) and the old judges' intake, wait for in-flight submissions to finish.
3. Final `backfill --fresh` (the id map is kept, so ids stay stable; rows deleted since an earlier run would otherwise fail `verify`), `rsync` media and problem data, then `verify`, start the worker alone (`systemctl start qhhoj-worker`) and `recompute`, then `check-files`, `check-integrity` (all exit 0 required; otherwise abort, the old site is untouched) and `finish`.
4. Stamp problem data, **after the last rsync** (an `rsync --delete` from the legacy tree removes stamps): `node dist/apps/migrator/main stamp-data-versions --root /srv/qhhoj/problem-data` (same env as the migration). The summary must show `invalidCode: 0`; `missingDirectory` counts problems without data on disk (they were IE on the old site too). Re-running it is safe.
5. Prune the languages no judge runs, **before the switch** (a submission in a language no judge advertises would sit in QU forever): `node dist/apps/migrator/main prune-languages --keep "$DAY_ONE_LANGUAGES,OUTPUT"` with the exact list every judge host's `selftest --require` passed ("Judge hosts" step 10; `OUTPUT` needs no runtime). Exit 0 and `unknownKeep: []` are required; keep the logged `prunedLanguages`, `problemsChanged` and `languagesDisabled` in the cutover notes. GAS32 and the other pruned languages keep their rows (disabled), so old submissions still show their language. Re-running it is safe. A language added to the fleet later is re-allowed per problem by its editors.
6. Start the new stack: `systemctl start qhhoj.target`, then run the smoke checks against the new host by `curl --resolve` or `/etc/hosts`.
7. Switch the judges, one host at a time: `systemctl disable --now <old DMOJ judge unit>`, then `systemctl enable --now qhhoj-judge`; `journalctl -u qhhoj-judge -n 20` shows `bridge session started` and the admin judge list shows the host online with its slots. Submit one AC, one WA and one CE on a known problem through the site and see the verdicts arrive live; if `count-data-shapes` listed `nestedCaseNames`, also submit an AC on one of those problems.
8. Switch DNS to the new host. All sessions are invalidated once, users log in again.
9. Watch `journalctl -u 'qhhoj-*' -f`, the judge list and `curl -s 127.0.0.1:9464/metrics` on each judge (`judge_assignments_total`, `judge_sandbox_failures_total`, `judge_reconnects_total`) for 30 minutes. Keep the old site and its database untouched, read-only, for the rollback period. HSTS ships at `max-age=300` for that period; afterwards raise it to `31536000` in `nginx/security-headers.conf`. The SPA CSP ships as Report-Only: after a few clean days rename it to `Content-Security-Policy`.

## Smoke checks

- `curl -fsS https://HOST/api/internal/site` returns JSON; `curl -I https://HOST/some/spa/route` returns 200 with the HTML shell.
- `curl -N https://HOST/api/internal/events/...` as a logged-in user prints a heartbeat within 15 s without delay (proves unbuffered).
- Log in, open a problem, submit a solution; a judge grades it; the verdict appears live.
- A statement PDF renders (worker + Chromium + pandoc); an uploaded image shows from `/media/`.
- `ss -ltn | grep 9999` is open locally but unreachable from outside the judge network; `systemctl status qhhoj-*` all active.
- `curl -sI https://HOST/s/nonexistent` is 404 (not the SPA shell: proves the `/s/` location); an integration key from outside its `allowedCidrs` is refused on `/api/sync/v1/...`.
- Registration works only after `mail.smtpUrl` is set (admin settings, `judge.change_settings`).

## Integration clients (sync API)

- `TRUST_PROXY` must be set behind nginx: each client's CIDR check and the failed-key lockout (20 bad `qhi_` keys in 10 minutes from one address answer 429 for every key from it) use `request.ip`; without it all clients share the proxy's address (the api logs a boot warning when active clients exist).
- After `grant-permissions`, check at rehearsal that a migrated admin group holds `judge.manage_integration` (its anchor is `judge.change_miscconfig`); superusers bypass it.
- A client's acting user must not be a superuser and must hold `judge.add_contest` and `judge.create_private_contest`; it may hold more than the key's creator, so use a dedicated account. Keys may carry `expiresAt`; each client gets 60 requests per minute.
- nginx needs the `/s/` and `/api/sync/` locations from `deploy/nginx/qhhoj.conf`.

## Deploy notes

- Stream caps per api process (fixed defaults, no env override): public submission feed 900 (was 1000), contest event-feed streams 100 (`contestFeedTotal`, new), contest streams 1500, notification streams 2000, total 5000. The caps add up to 4500, which leaves 500 slots for submission and ticket streams. Beyond a cap the api answers 429; with several api processes behind nginx each process counts on its own. A load balancer or monitoring that assumed 1000 feed streams per process needs the new numbers.
- Request bodies over a route's limit answer 413 with error code `payload_too_large` (it was `http_error`).

## Backup

- Secrets: keep `/etc/qhhoj/env` (at least `ENCRYPTION_KEY`, `TOKEN_SECRET`) in an offline secret store, separate from the dumps; encrypted settings and 2FA secrets in a dump are useless without the same `ENCRYPTION_KEY`.
- Mongo: `mongodump --uri "$MONGO_URL" --gzip --archive=/backup/qhhoj-$(date +%F).gz` nightly (no `--oplog`: not point-in-time, acceptable nightly); restore with `mongorestore --gzip --archive=... --drop`. Test a restore once.
- Data roots: restic (or dated snapshots, not a `--delete` mirror) of `MEDIA_ROOT` and `PROBLEM_DATA_ROOT` nightly, right after the mongodump; `PDF_CACHE_ROOT`, `CONTEST_DATA_ROOT` and `USER_DATA_ROOT` are regenerable and need no backup.
- Redis holds no durable state (queue truth is Mongo); no backup needed.

## Rollback

- Before DNS switch: `systemctl stop qhhoj.target`, reopen the old site (remove the read-only rule), repoint the judges with their old build and config (keep both). Nothing was lost.
- After DNS switch: new-site writes exist only in Mongo. Decide quickly: either accept the loss and switch DNS back to the old site (and its judges), or fix forward. There is no reverse migration; submissions made on the new site are not replayed to the old one.
- Keep the old database and uploads unmodified until the rollback period (suggest 2 weeks) ends.

## Judge hosts

Dedicated Ubuntu 24.04 hosts, nothing else on them. Per host, as root:

1. Kernel and boot: cgroups v2 is the default on 24.04 (`/sys/fs/cgroup/cgroup.controllers` exists). Turn SMT off (`echo off > /sys/devices/system/cpu/smt/control` and `nosmt` in `GRUB_CMDLINE_LINUX`, `update-grub`), swap off (`swapoff -a`, remove the swap line from `/etc/fstab`), `sysctl -w kernel.randomize_va_space=2`, `kernel.apparmor_restrict_unprivileged_userns=1` and `kernel.core_pattern=core` (persist all three in `/etc/sysctl.d/90-qhhoj-judge.conf`), `apt install unattended-upgrades chrony linux-tools-common linux-tools-$(uname -r)`. Timing stability, persisted by a oneshot unit:
   ```ini
   # /etc/systemd/system/qhhoj-judge-tuning.service
   [Unit]
   Description=Judge host CPU and memory tuning (THP off, performance governor, boost off)
   Before=qhhoj-judge.service isolate.service
   [Service]
   Type=oneshot
   RemainAfterExit=yes
   ExecStart=/bin/sh -c 'echo never > /sys/kernel/mm/transparent_hugepage/enabled; echo never > /sys/kernel/mm/transparent_hugepage/defrag; echo 0 > /sys/kernel/mm/transparent_hugepage/khugepaged/defrag'
   ExecStart=/usr/bin/cpupower frequency-set -g performance
   ExecStart=/bin/sh -c 'if [ -w /sys/devices/system/cpu/cpufreq/boost ]; then echo 0 > /sys/devices/system/cpu/cpufreq/boost; fi; if [ -w /sys/devices/system/cpu/intel_pstate/no_turbo ]; then echo 1 > /sys/devices/system/cpu/intel_pstate/no_turbo; fi'
   [Install]
   WantedBy=multi-user.target
   ```
   `systemctl daemon-reload && systemctl enable --now qhhoj-judge-tuning.service`.
   **Accepted waiver:** `isolate-check-environment` reports ASLR (`kernel.randomize_va_space=2`) as a problem; the spec (§6) requires ASLR = 2, so that one check is waived. Every other check it reports as `FAIL`, `CAUTION` or `WARNING` (THP and khugepaged defrag, governor, boost, `core_pattern`, swap, SMT) must be fixed; `check-host.sh` enforces exactly this.
2. isolate 2.6: `apt install build-essential libcap-dev libsystemd-dev pkg-config git`; `git clone --depth 1 --branch v2.6 https://github.com/ioi/isolate /usr/local/src/isolate && cd /usr/local/src/isolate && make isolate isolate-cg-keeper && make install`; `cp systemd/isolate.service systemd/isolate.slice /etc/systemd/system/ && systemctl daemon-reload && systemctl enable --now isolate.service`. In `/usr/local/etc/isolate` keep `box_root = /var/local/lib/isolate` (local disk, never NFS) and `cg_root = auto:/run/isolate/cgroup`. The box count must be at least `box_base + 2 × slots`: with the shipped `subid_user = isolate` it is the smaller of that user's `/etc/subuid` and `/etc/subgid` blocks (`useradd --system isolate` and `usermod --add-subuids 200000-265535 --add-subgids 200000-265535 isolate`), otherwise `num_boxes`. `isolate-check-environment` must be clean except the ASLR check (step 1's waiver). `/usr/local/bin/isolate` must stay `root`-owned and setuid (`4755`).
3. Compilers (the day-one set, legacy-judge-usage.md): `apt install gcc g++ clang fp-compiler python3 pypy3 default-jdk-headless ruby gdc lua5.4 gnat bf binutils`; Kotlin from its GitHub release into `/opt/kotlinc` with `/usr/bin/kotlinc` linked to it; SCRATCH: `packaging/install-scratch-run.sh` from the judge-v2 release (only if plan B Task 35's gate passed). GAS32 is not offered: isolate 2.6's seccomp filter kills 32-bit binaries.
4. User and directories: `useradd --system --no-create-home --shell /usr/sbin/nologin qhhoj-judge`; `install -d -m 0755 /opt/qhhoj-judge/releases /etc/qhhoj-judge /srv/qhhoj/problem-data`.
5. Problem data over NFS (read-only). On the site host: `apt install nfs-kernel-server`; `/etc/exports`: `/srv/qhhoj/problem-data <judge-ip>(ro,all_squash,anonuid=<qhhoj uid>,anongid=<qhhoj gid>,no_subtree_check,sec=sys)` (one line per judge host), `exportfs -ra`; allow TCP 2049 from judge hosts only. On the judge host: `apt install nfs-common`; `/etc/fstab`: `<site-private-ip>:/srv/qhhoj/problem-data /srv/qhhoj/problem-data nfs4 ro,nosuid,nodev,noexec,hard,vers=4.2,actimeo=1,_netdev 0 0`; `mount -a`. `actimeo=1` keeps `.data-version` fresh (the judge waits only 10 s for a newer stamp). `sec=sys` trusts the client's IP and uid: use it only on the private LAN between the site host and judge hosts; a judge outside that LAN needs a WireGuard tunnel (export to its tunnel address) or `sec=krb5p`.
6. TLS (once, on an offline machine or the site host, files kept with the env secrets):
   `openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 3650 -subj "/CN=QHHOJ judge CA" -keyout judge-ca.key -out judge-ca.pem`;
   `openssl req -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -subj "/CN=bridge.qhhoj.internal" -keyout bridge.key -out bridge.csr`;
   `openssl x509 -req -in bridge.csr -CA judge-ca.pem -CAkey judge-ca.key -CAcreateserial -days 825 -extfile <(printf "subjectAltName=DNS:bridge.qhhoj.internal,IP:<bridge-private-ip>\nextendedKeyUsage=serverAuth") -out bridge.pem`.
   Site host: `install -d -m 0750 -o root -g qhhoj /etc/qhhoj/bridge-tls`, `install -m 0644 -o root -g root bridge.pem /etc/qhhoj/bridge-tls/cert.pem` and `install -m 0600 -o qhhoj -g qhhoj bridge.key /etc/qhhoj/bridge-tls/key.pem` (the bridge's user `qhhoj`, `deploy/systemd/qhhoj-bridge.service`; no group read); `JUDGE_BRIDGE_TLS_CERT` and `JUDGE_BRIDGE_TLS_KEY` in `/etc/qhhoj/env` point at them (`deploy/env.production.example`). Judge hosts: `install -m 0644 judge-ca.pem /etc/qhhoj-judge/bridge-ca.pem` and resolve `bridge.qhhoj.internal` to the bridge's private address (`/etc/hosts`). `judge-ca.key` never leaves the offline store. Renew the bridge certificate before its 825 days end (same CA, no judge change): install the new pair as above, then `systemctl restart qhhoj-bridge` (the bridge reads the certificate only at boot; judges reconnect and resume their runs within the 30 s grace).
7. Judge key: in the admin UI create the judge; the key is shown once. `install -m 0400 -o root -g root /dev/stdin /etc/qhhoj-judge/key` and paste it. Rotation later: rotate in the UI (the judge is disconnected), replace the file, `systemctl restart qhhoj-judge`.
8. Install the release: `tar -xzf qhhoj-judge-<ver>.tar.gz -C /opt/qhhoj-judge/releases/ && mv /opt/qhhoj-judge/releases/qhhoj-judge-<ver> /opt/qhhoj-judge/releases/<ver>`; `(cd /opt/qhhoj-judge/releases/<ver> && sha256sum -c SHA256SUMS)`; `ln -sfn releases/<ver> /opt/qhhoj-judge/current`. Config: copy `deploy/judge/config.example.toml` to `/etc/qhhoj-judge/config.toml`, set `name` (the admin UI name), `bridge_url = "https://bridge.qhhoj.internal:9999"`, `[tls] server_name`, and leave `slots`/`cores` unset unless the host shares cores. Unit: `cp deploy/judge/qhhoj-judge.service /etc/systemd/system/ && systemctl daemon-reload && systemctl enable qhhoj-judge`.
9. Firewall: `cp deploy/judge/nftables-judge.conf /etc/nftables.conf`, fill the addresses, `nft -c -f /etc/nftables.conf`, `systemctl enable --now nftables`. Egress only to the bridge port, NFS (2049) on the site host, DNS, NTP and the apt mirror; ingress only SSH from the admin network.
10. Verify: `sudo -u qhhoj-judge /opt/qhhoj-judge/current/qhhoj-judge selftest --config /etc/qhhoj-judge/config.toml --require "$DAY_ONE_LANGUAGES"` with `DAY_ONE_LANGUAGES=C,C11,CLANG,CPP03,CPP11,CPP14,CPP17,CPP20,CPP23,CLANGX,PY3,PYPY3,PAS,JAVA,JAVA8,KOTLIN,RUBY,D,LUA,ADA,BF,GAS64,TEXT` (plan B's CI `JUDGE_SUITE_REQUIRE` plus KOTLIN; append `,SCRATCH` only if plan B Task 35's gate passed) → every line `ok`. Every host runs the same list: the cutover's `prune-languages --keep` (Cutover sequence step 5) uses this list plus `OUTPUT`, so a language missing on one host is either fixed or dropped from the list on every host before the window. `deploy/judge/check-host.sh --bridge bridge.qhhoj.internal:9999` → all `ok`; `systemctl show qhhoj-judge -p NoNewPrivileges` must print `NoNewPrivileges=no` (on systemd 255 a `RestrictAddressFamilies=` or similar line must not have implied it; if it prints `yes`, isolate cannot gain its setuid root and every run fails); then (only once the new bridge runs) `systemctl start qhhoj-judge`, `journalctl -u qhhoj-judge -n 20` shows `bridge session started`, the admin judge list shows the judge online with its slots, and an AC submission is graded. `curl -s 127.0.0.1:9464/metrics | grep judge_slots_busy` answers on the host.

## Judge connection

- Judges run judge-v2 (`qhhoj-judge`, repo `judge-v2`) and open a gRPC `qhhoj.judge.v1` link to `JUDGE_BRIDGE_HOST:JUDGE_BRIDGE_PORT` (default 9999), sending the judge name and key as `x-judge-name`/`x-judge-key` metadata. Runs survive a reconnect within 30 s (resume).
- TLS: set `JUDGE_BRIDGE_TLS_CERT` and `JUDGE_BRIDGE_TLS_KEY` (both or neither); a non-loopback host without them refuses to start. Judges pin the private CA (`/etc/qhhoj-judge/bridge-ca.pem`) and check the server name ("Judge hosts" step 6). The pair is read once at start: after renewing it, restart the bridge (`systemctl restart qhhoj-bridge`); judges reconnect and resume. Plaintext is accepted only when the bridge binds loopback (local stacks).
- Create or rotate the judge and its key in the admin UI (the key is shown once; a rotate or block ends every session of the judge and closes its connections at once). Judges are not migrated; register them fresh and issue new keys. On the host the key lives in `/etc/qhhoj-judge/key` (0400 root) and reaches the daemon through `LoadCredential=`; it is re-read on every reconnect.
- Limits: one connection per judge (a newer session replaces the older one); a connection with no session is closed after 15 s; 8 such connections per address; an address with 20 failed key checks in a minute is refused for the rest of that minute (logged as `Judge key check failed from <address>`).
- Only one bridge instance may run. Bind `JUDGE_BRIDGE_HOST` to the private interface and firewall the port to judge hosts; nginx never proxies it. Remote judges connect only over a private network or WireGuard. `/api/internal/openapi.json` is public and lists admin routes (all permission-guarded); deny it in nginx if unwanted.
- Judges need no HTTP access to the site: file-only submissions come over `FetchSource`. Problem data is the read-only NFS mount of `PROBLEM_DATA_ROOT` ("Judge hosts" step 5).
- Update a host: unpack the release into `/opt/qhhoj-judge/releases/<ver>`, `sha256sum -c SHA256SUMS`, `sudo -u qhhoj-judge .../qhhoj-judge selftest --config /etc/qhhoj-judge/config.toml`, `ln -sfn releases/<ver> /opt/qhhoj-judge/current`, `systemctl restart qhhoj-judge` (SIGTERM drains: no new work, running submissions finish for up to 120 s). Roll hosts one at a time, waiting for each to show online. Roll back a release by pointing `current` at the previous one and restarting.
- Local development: `STACK_JUDGE=none npm run stack:up && npm run judge:v2:up` (CONTRIBUTING "Local judge").
