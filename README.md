# QHHOJ backend-v2

Backend of the QHHOJ online judge: NestJS 11 (Fastify) + Mongoose 8 on MongoDB, with Redis and BullMQ. It replaces the Django/MariaDB site; judges (DMOJ protocol) connect to its bridge.

## Requirements

- Node 22
- MongoDB 8 as a **replica set** (transactions, change streams)
- Redis >= 7
- Optional: MariaDB 11 (legacy source for the migrator and its tests only)
- Worker only: official static `pandoc` >= 3 (the Debian/Ubuntu build cannot start threads under the 768 MiB `prlimit` cap), util-linux `prlimit`, Chromium (`npx playwright install --with-deps chromium`)
- Build (`npm ci`, worker image and CI): `python3`, `make`, `g++` for the tree-sitter grammars of the similarity engine; the worker runs one similarity job at a time

`docker compose up -d mongo redis mailpit` starts the local services (`mariadb` too if you need it).

## Setup

```
npm ci
cp .env.example .env   # fill ENCRYPTION_KEY (32 bytes hex) and TOKEN_SECRET at least
set -a; . ./.env; set +a   # the apps read process.env; they do not load .env themselves
```

`.env.example` lists every variable with a comment; [CONTRIBUTING.md](CONTRIBUTING.md#env-and-deploy) explains the shared volumes and deploy requirements. Each app validates its env at boot and fails fast.

Env holds only infrastructure and key material (database, Redis, secrets, paths, ports). Everything an operator may want to change at runtime (SMTP and mail sender, social login clients, Discord webhooks, the breach-check URL, PDF limits, official contest mode, the disqualification ban threshold, the site time zone) is an admin setting, edited without a restart: `GET /api/internal/admin/settings` lists them, `PATCH /api/internal/admin/settings/<key>` with `{ "value": ... }` changes one (permission `judge.change_settings`, grant it to superusers only; secrets are never returned, every change is recorded). How to add one: [CONTRIBUTING.md](CONTRIBUTING.md#runtime-settings).

### After upgrading

The settings default to off or to the site defaults, so after deploying set in the admin API what you use (the old variables are not read; boot logs one warning, "Ignoring X, Y: these are admin settings now", naming any still set, and ignores them):

- `mail.smtpUrl` (e.g. `smtps://user:pass@host:465`, credentials percent-encoded) and `mail.from`: without an SMTP URL registration answers 503 `mail_unavailable`, while password reset and activation resend answer 204 and the mail is lost (logged)
- `auth.google`, `auth.github`, `auth.facebook`: `{ "enabled": true, "clientId": "...", "clientSecret": "..." }` per provider you offer
- `discord.webhooks`: `{ "default": "https://discord.com/api/webhooks/..." }` or per-event keys
- `site.timeZone` if the site is not on `Asia/Ho_Chi_Minh` (the statistics strip's "today")
- optionally `auth.pwnedApiUrl` (default Have I Been Pwned), `pdf.renderTimeoutMs`, `pdf.maxBytes`, `contest.officialMode`, `contest.banAfterDisqualifications`

Deploy requirements:

- nginx: serve `/media/submission_file/` with `Content-Disposition: attachment`, `Content-Security-Policy: sandbox` and `X-Content-Type-Options: nosniff`
- judges must reach `SITE_URL` + `MEDIA_URL` over HTTP(S) (file submissions are sent to them as absolute URLs)
- purge the contest ranking caches built before this deploy; they lack `rating` and `organization` until recomputed

Local mail: start Mailpit (`docker compose up -d mailpit`), then `npm run seed:e2e` (see Run) sets `mail.smtpUrl` to it, or PATCH `mail.smtpUrl` to `smtp://localhost:1025` yourself.

## Run

Run each from the repo root (the worker needs `node_modules` for KaTeX's CSS).

| App                                    | Dev                       | Production                                                |
| -------------------------------------- | ------------------------- | --------------------------------------------------------- |
| api (`:3000`)                          | `npm run start:dev`       | `npm run build && npm run start:prod`                     |
| worker                                 | `npm run start:worker`    | `npx nest build worker && npm run start:prod:worker`      |
| bridge (`:9999`, exactly one instance) | `npm run start:bridge`    | `npx nest build bridge && npm run start:prod:bridge`      |
| migrator (CLI)                         | `npx nest build migrator` | `node dist/apps/migrator/main backfill\|verify [jobs...]` |

OpenAPI JSON: `GET /api/internal/openapi.json` (request and response schemas of every route; the frontend generates its types from it). `npm run test:openapi` checks that every JSON route has a response schema.

Dev and end-to-end data: `NODE_ENV=development npm run seed:e2e` creates `e2e_admin`, `e2e_user`, problem `e2e_sum` and the Mailpit mail setting (idempotent, refuses outside `test`/`development`).

## Tests and checks

```
npm test               # jest --runInBand (needs Redis; the api e2e flushes its db)
npm run lint
npm run typecheck
```

- Always `--runInBand`: suites share one Redis db.
- `TEST_REDIS_URL` picks the db (default `redis://127.0.0.1:6379/15`); use another db to run two checkouts side by side, e.g. `TEST_REDIS_URL=redis://127.0.0.1:6379/14 npm test`.
- MongoDB is in-memory (`mongodb-memory-server`); the migrator e2e also needs MariaDB (`TEST_MYSQL_URL`) and fails without it.

## Architecture

```
apps/api       HTTP: /api/internal (SPA), SSE streams
apps/bridge    judge TCP server, dispatch queue, grading
apps/worker    BullMQ jobs
apps/migrator  MariaDB -> MongoDB backfill/verify CLI
libs/          common, database, auth, render, problems, judging, contests, community
```

### Submission flow

1. The api accepts `POST /api/internal/problems/:code/submit`, stores the submission as `QU` and sends a `judge` command on the Redis stream `bridge:commands`.
2. The **bridge** claims it (`QU` -> `P`), picks a judge by priority and load, and sends it over the DMOJ protocol. Mongo is the queue truth; the bridge rebuilds its queue from it on start.
3. The **judge** returns case results and a verdict; the bridge writes them and publishes progress on Redis `submission-events`.
4. On finish the bridge enqueues a `submission-graded` job.
5. The worker's **effects** (`submission-effects`) recompute user points/PP, problem stats and, for contest submissions, the participation and ranking. A sweep repairs lost jobs.
6. The api serves **SSE** from the Redis events (`/api/internal/events/submissions/:id`, the public feed and `/events/contests/:key`).

Inside a current contest, step 1 also adds a contest submission to the viewer's participation (joining creates it); `final_submission` contests hold submissions as `PD` until the end.

### Jobs (`apps/worker/src/jobs`)

| Job                   | Purpose                                                                 |
| --------------------- | ----------------------------------------------------------------------- |
| `submission-effects`  | consume `submission-graded`: points, stats, contest scoring             |
| `effects-sweep`       | every 10 min, recompute what lost a graded job                          |
| `problem-rescore`     | rescore a problem's submissions after a points change                   |
| `contest-rescore`     | recompute every participation of a contest                              |
| `contest-final-judge` | requeue `PD` rows of a final-submission contest at its end              |
| `contest-rating`      | Elo-MMR rating run                                                      |
| `similarity`          | code-similarity run (Dolos) per problem or contest                      |
| `contest-data`        | contest data zip                                                        |
| `organization-points` | organization PP and member counts                                       |
| `user-data`           | user data export zips, hourly expiry sweep                              |
| `contribution-points` | users' contribution points (votes, hidden comments, posts, suggestions) |
| `discord-webhook`     | Discord announcements                                                   |
| `pdf-render`          | statement PDFs (Playwright)                                             |
| `polygon-import`      | Polygon package import                                                  |

## Where to change what

| To change                                                      | Look in                                                                                                                                                                                                                 |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An HTTP endpoint                                               | `apps/api/src/modules/<feature>/<sub-feature>/` (controller, service, `dto/`); register it in the feature's `*-api.module.ts` (flat modules such as `events/`, `tags/`, `judges/` use their own module file) |
| Who can see/edit a problem or contest                          | `modules/problems/core/problem-access.ts`, `modules/contests/core/contest-access.ts`                                                                                                                                    |
| A contest scoring format                                       | `libs/contests/src/formats/<kebab-case-name>.ts` and `registry.ts`                                                                                                                                                      |
| Contest viewer fields (list `viewer`, detail `viewerResult`, `solverCount`) | `modules/contests/core/contest-viewer.service.ts`, `core/contest-problem-facts.service.ts`, `core/solver-counts.service.ts`, `core/viewer-problem-results.ts` |
| Contest register/join/leave refusal codes | `modules/contests/participation/participation-refusals.ts` |
| Who can see/administer an organization                         | `modules/organizations/core/organization-access.ts`                                                                                                                                                                     |
| Who can see/edit a blog post                                   | `modules/blog/core/blog-access.ts`                                                                                                                                                                                      |
| Which comment pages a viewer may read (and comment page types) | `modules/comments/core/comment-pages.service.ts`                                                                                                                                                                        |
| Votes, contribution points                                     | `modules/contributions/`, `libs/community/src/contribution.ts`, job in `apps/worker/src/jobs/contribution-points`                                                                                                       |
| Homepage data, RSS/Atom feeds                                  | `apps/api/src/modules/home/`                                                                                                                                                                                            |
| Code similarity                                                | `modules/similarity/`, job in `apps/worker/src/jobs/similarity`, language families in `similarity-languages.ts`                                                                                                         |
| Discord webhooks                                               | `libs/community/src/discord.ts`, `modules/discord/`, job in `apps/worker/src/jobs/discord-webhook`                                                                                                                      |
| Who can see/edit a ticket                                      | `modules/tickets/core/ticket-access.ts` (list filter: `ProblemAccess.editableFilter`)                                                                                                                                   |
| Ticket events (SSE) and Discord texts                          | `modules/tickets/streams/`, `libs/community/src/ticket-events.ts`, `libs/community/src/tickets.ts`                                                                                                                      |
| Flatpages, navigation bar, misc config                         | `modules/site/`                                                                                                                                                                                                         |
| User activity capture and its staff API                        | `modules/user-activity/capture/`, `modules/user-activity/staff/`, rules in `libs/community/src/user-activity.ts`                                                                                                        |
| Org PP, ranks, interaction gate, comment and blog rules        | `libs/community/src`                                                                                                                                                                                                    |
| Rating                                                         | `libs/contests/src/rating/elo-mmr.ts`, job in `apps/worker/src/jobs/contest-rating`                                                                                                                                     |
| Points, PP, problem stats                                      | `libs/judging/src/points.ts`, `apps/worker/src/jobs/submission-effects`                                                                                                                                                 |
| Judge protocol, dispatch, grading                              | `apps/bridge/src/{protocol,dispatch,judges,submissions}`                                                                                                                                                                |
| SSE channels and limits                                        | `apps/api/src/modules/events/`, channel services under `submissions/streams` and `contests/announcements`                                                                                                               |
| Auth, sessions, permissions                                    | `libs/auth/src`, flows in `modules/auth/<flow>/`; new permissions in `libs/auth/src/principal/permissions.ts`                                                                                                           |
| Markdown rendering                                             | `libs/render/src` (goldens in `src/fixtures`)                                                                                                                                                                           |
| `init.yml`, zip handling, data files                           | `libs/problems/src`, routes in `modules/problems/data`                                                                                                                                                                  |
| A Mongo schema                                                 | `libs/database/src/schemas/` (register in `SCHEMAS`)                                                                                                                                                                    |
| A background job                                               | `apps/worker/src/jobs/<job>/` and its queue contract in `libs/<lib>/src/queues.ts`                                                                                                                                      |
| A legacy import                                                | `apps/migrator/src/mappers/`                                                                                                                                                                                            |
| Env variables                                                  | `libs/common/src/env/`, `.env.example`                                                                                                                                                                                  |
| A runtime setting (admin-editable)                             | one entry in `libs/settings/src/registry.ts`; admin API in `modules/settings/`                                                                                                                                          |
| OpenAPI schemas                                                | `dto/*.response.ts`; `libs/common/src/openapi/`                                                                                                                                                                         |

## More

- [CONTRIBUTING.md](CONTRIBUTING.md): layout, patterns, naming, testing, per-area rules, deploy notes
- [docs/decisions.md](docs/decisions.md): design decisions and why
