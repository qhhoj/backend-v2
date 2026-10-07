# QHHOJ backend-v2

Backend of the QHHOJ online judge: NestJS 11 (Fastify) + Mongoose 8 on MongoDB, with Redis and BullMQ. It replaces the Django/MariaDB site; judges (DMOJ protocol) connect to its bridge.

## Requirements

- Node 22
- MongoDB 8 as a **replica set** (transactions, change streams)
- Redis >= 7
- Optional: MariaDB 11 (legacy source for the migrator and its tests only)
- Worker only: `pandoc` >= 3, util-linux `prlimit`, Chromium (`npx playwright install --with-deps chromium`)

`docker compose up -d mongo redis mailpit` starts the local services (`mariadb` too if you need it).

## Setup

```
npm ci
cp .env.example .env   # fill ENCRYPTION_KEY (32 bytes hex) and TOKEN_SECRET at least
set -a; . ./.env; set +a   # the apps read process.env; they do not load .env themselves
```

`.env.example` lists every variable with a comment; [CONTRIBUTING.md](CONTRIBUTING.md#env-and-deploy) explains the shared volumes and deploy requirements. Each app validates its env at boot and fails fast.

## Run

Run each from the repo root (the worker needs `node_modules` for KaTeX's CSS).

| App | Dev | Production |
|---|---|---|
| api (`:3000`) | `npm run start:dev` | `npm run build && npm run start:prod` |
| worker | `npm run start:worker` | `npx nest build worker && npm run start:prod:worker` |
| bridge (`:9999`, exactly one instance) | `npm run start:bridge` | `npx nest build bridge && npm run start:prod:bridge` |
| migrator (CLI) | `npx nest build migrator` | `node dist/apps/migrator/main backfill\|verify [jobs...]` |

OpenAPI JSON: `GET /api/internal/openapi.json`.

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
apps/api       HTTP: /api/internal (SPA), /api/v2 (legacy shapes), SSE streams
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

| Job | Purpose |
|---|---|
| `submission-effects` | consume `submission-graded`: points, stats, contest scoring |
| `effects-sweep` | every 10 min, recompute what lost a graded job |
| `problem-rescore` | rescore a problem's submissions after a points change |
| `contest-rescore` | recompute every participation of a contest |
| `contest-final-judge` | requeue `PD` rows of a final-submission contest at its end |
| `contest-rating` | Elo-MMR rating run |
| `contest-moss` | MOSS plagiarism run |
| `contest-data` | contest data zip |
| `organization-points` | organization PP and member counts |
| `user-data` | user data export zips, hourly expiry sweep |
| `pdf-render` | statement PDFs (Playwright) |
| `polygon-import` | Polygon package import |

## Where to change what

| To change | Look in |
|---|---|
| An HTTP endpoint | `apps/api/src/modules/<feature>/<sub-feature>/` (controller, service, `dto/`); register it in the feature's `*-api.module.ts` (flat modules such as `events/`, `api-v2/`, `tags/`, `judges/` use their own module file) |
| Who can see/edit a problem or contest | `modules/problems/core/problem-access.ts`, `modules/contests/core/contest-access.ts` |
| A contest scoring format | `libs/contests/src/formats/<kebab-case-name>.ts` and `registry.ts` |
| Who can see/administer an organization | `modules/organizations/core/organization-access.ts` |
| Org PP, ranks, interaction gate | `libs/community/src` |
| Rating | `libs/contests/src/rating/elo-mmr.ts`, job in `apps/worker/src/jobs/contest-rating` |
| Points, PP, problem stats | `libs/judging/src/points.ts`, `apps/worker/src/jobs/submission-effects` |
| Judge protocol, dispatch, grading | `apps/bridge/src/{protocol,dispatch,judges,submissions}` |
| SSE channels and limits | `apps/api/src/modules/events/`, channel services under `submissions/streams` and `contests/announcements` |
| Auth, sessions, permissions | `libs/auth/src`, flows in `modules/auth/<flow>/`; new permissions in `libs/auth/src/principal/permissions.ts` |
| Markdown rendering | `libs/render/src` (goldens in `src/fixtures`) |
| `init.yml`, zip handling, data files | `libs/problems/src`, routes in `modules/problems/data` |
| `/api/v2` legacy shapes | `apps/api/src/modules/api-v2` |
| A Mongo schema | `libs/database/src/schemas/` (register in `SCHEMAS`) |
| A background job | `apps/worker/src/jobs/<job>/` and its queue contract in `libs/<lib>/src/queues.ts` |
| A legacy import | `apps/migrator/src/mappers/` |
| Env variables | `libs/common/src/env/`, `.env.example` |

## More

- [CONTRIBUTING.md](CONTRIBUTING.md): layout, patterns, naming, testing, per-area rules, deploy notes
- [docs/decisions.md](docs/decisions.md): design decisions and why
