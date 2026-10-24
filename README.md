# QHHOJ backend-v2

Backend of the QHHOJ online judge: NestJS 11 (Fastify) + Mongoose 8 on MongoDB, with Redis and BullMQ. It replaces the Django/MariaDB site; judge-v2 judges connect to its bridge over gRPC (TLS).

## Requirements

- Node 22
- MongoDB 8 as a **replica set** (transactions, change streams)
- Redis >= 7
- Worker only: official static `pandoc` >= 3 (the Debian/Ubuntu build cannot start threads under the 768 MiB `prlimit` cap), util-linux `prlimit`, Chromium (`npx playwright install --with-deps chromium`)
- Build (`npm ci`, worker image and CI): `python3`, `make`, `g++` for the tree-sitter grammars of the similarity engine; the worker runs one similarity job at a time

`docker compose up -d mongo redis mailpit` starts the local services.

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
- judges need no HTTP access to the site: file submissions are streamed over the judge link (`FetchSource`)
- purge the contest ranking caches built before this deploy; they lack `rating` and `organization` until recomputed

Local mail: start Mailpit (`docker compose up -d mailpit`), then `npm run seed:e2e` (see Run) sets `mail.smtpUrl` to it, or PATCH `mail.smtpUrl` to `smtp://localhost:1025` yourself.

## Run

Run each from the repo root (the worker needs `node_modules` for KaTeX's CSS).

| App                                    | Dev                    | Production                                           |
| -------------------------------------- | ---------------------- | ---------------------------------------------------- |
| api (`:3000`)                          | `npm run start:dev`    | `npm run build && npm run start:prod`                |
| worker                                 | `npm run start:worker` | `npx nest build worker && npm run start:prod:worker` |
| bridge (`:9999`, exactly one instance) | `npm run start:bridge` | `npx nest build bridge && npm run start:prod:bridge` |

API reference: `GET /api/docs` ([Scalar](https://scalar.com), https://qhhoj.com/api/docs) renders the live OpenAPI document, so it cannot drift from the code; the bundle is served by the api itself (no third-party script or font).

OpenAPI JSON: `GET /api/internal/openapi.json` (request and response schemas of every route); the committed copy is `openapi.json` (`npm run openapi:emit` rewrites it offline); the frontend generates its types from it. After a DTO or route change run `npm run openapi:emit` and commit `openapi.json` (CI fails on a stale copy). `npm run test:openapi` checks the schemas.

Dev and end-to-end data: `NODE_ENV=development npm run seed:e2e` creates `e2e_admin`, `e2e_user`, problem `e2e_sum` and the Mailpit mail setting (idempotent, refuses outside `test`/`development`).

## Tests and checks

```
npm test               # every spec (needs Redis; the api e2e flushes its db)
npm run test:unit      # pure and static specs only, no services (CI job `test`)
npm run test:db        # *.db.spec.ts and *.e2e-spec.ts (needs Redis; CI job `db`)
npm run lint
npm run typecheck
```

- CI runs `test:unit`, the static `test:openapi` and, in the `db` job (Redis container with 100 databases, cached mongod binary), `test:db`. Specs that need services are named `*.db.spec.ts` or `*.e2e-spec.ts` (CONTRIBUTING.md, Testing). `test:db` runs in band, in CI too: with `--maxWorkers=2` and up, workers get separate Redis and Mongo databases but share the `submission-events` pub/sub channel, so specs can see each other's events.
- `TEST_REDIS_URL` picks the db (default `redis://127.0.0.1:6379/15`); use another db to run two checkouts side by side, e.g. `TEST_REDIS_URL=redis://127.0.0.1:6379/12 npm test`. Each jest worker uses the next db up (db + `JEST_WORKER_ID - 1`), so the base db plus `--maxWorkers` must fit the server (16 dbs by default).
- MongoDB is in-memory (`mongodb-memory-server`): one replica set per jest run (`test/jest/global-setup.js`); `startMongo()` gives each caller databases of its own on it and drops them on `stop()`.

## Architecture

```
apps/api       HTTP: /api/internal (SPA), SSE streams
apps/bridge    judge gRPC server, dispatch queue, grading
apps/worker    BullMQ jobs
libs/          common, database, auth, render, problems, judging, contests, community
```

### Submission flow

| #   | Process | What happens                                                                                                                                                                     | File and method                                                                                                           |
| --- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1   | api     | `POST /api/internal/problems/:code/submit` stores the submission as `QU` and sends a `judge` command on the Redis stream `bridge:commands`                                       | `modules/submissions/create/submission-create.service.ts` `submit`; `libs/judging/src/bridge-commands.service.ts` `judge` |
| 2   | bridge  | reads the stream and puts the row in the dispatch queue; Mongo is the queue truth, so the bridge rebuilds its queue from it on start                                             | `dispatch/commands.service.ts` `apply`; `dispatch/dispatcher.service.ts` `enqueue`                                        |
| 3   | bridge  | a judge with a free slot takes the next row it fits; the **claim** moves `QU` to `P` and bumps the judging generation, then the bridge sends Assign over gRPC (`qhhoj.judge.v1`) | `dispatcher.service.ts` `offerWork`; `submissions/runs.service.ts` `claim`                                                |
| 4   | bridge  | the judge's messages (accepted, compiled, started, cases, final) are written under a sequence number, and progress goes out on Redis `submission-events`                         | `link/judge-session.ts` `handle`; `submissions/runs.service.ts` `cases`, `final`                                          |
| 5   | bridge  | on a final verdict the bridge enqueues the `submission-graded` job                                                                                                               | `submissions/runs.service.ts` `final`; `libs/judging/src/notify-graded.ts` `notifyGraded`                                 |
| 6   | worker  | the **effects** recompute user points/PP, problem stats and, for a contest submission, the participation and ranking; the sweep repairs lost jobs                                | `jobs/submission-effects/submission-effects.service.ts` `apply`; `jobs/effects-sweep/effects-sweep.service.ts`            |
| 7   | api     | serves **SSE** from the Redis events (`/api/internal/events/submissions/:id`, the public feed, `/events/contests/:key`)                                                          | `modules/submissions/streams/submission-streams.service.ts` `openSubmission`, `openFeed`                                  |

Inside a current contest, step 1 also adds a contest submission to the viewer's participation (joining creates it); `final_submission` contests hold submissions as `PD` until the end. Vocabulary: [GLOSSARY.md](GLOSSARY.md) (Claim, Effects, Sweep, Status codes).

### Jobs (`apps/worker/src/jobs`)

One folder per job. Schedule: a repeating job registers its own scheduler when the worker starts; the rest run when something enqueues them. Boot routines are not jobs: they run once at every worker start and are idempotent.

| Job                              | Schedule                 | Purpose                                                                 |
| -------------------------------- | ------------------------ | ----------------------------------------------------------------------- |
| `submission-effects`             | on `submission-graded`   | points, stats, contest scoring of one graded submission                 |
| `effects-sweep`                  | every 10 min             | recompute what lost a graded job                                        |
| `problem-rescore`                | on points change         | rescore a problem's submissions after a points change                   |
| `problem-solvers`                | on delete or restore     | recompute the solvers of a problem that left or re-entered the counts   |
| `contest-rescore`                | on contest change        | recompute every participation of a contest                              |
| `contest-final-judge`            | every 1 min              | requeue `PD` rows of a final-submission contest at its end              |
| `contest-publish`                | every 1 min              | publish a contest's problems and editorials at its end                  |
| `contest-rating`                 | on request               | Elo-MMR rating run                                                      |
| `contest-data`                   | on request               | contest data zip                                                        |
| `contest-export`                 | on request               | contest export zip (submissions CSV and sources)                        |
| `contest-replay`                 | on request               | build the replay chunks of an ended contest                             |
| `similarity`                     | on request               | code-similarity run (Dolos) per problem or contest                      |
| `organization-points`            | on change                | organization PP and member counts                                       |
| `organization-usage-audit`       | daily 03:00              | compare the credit counters with the ledger; reports, never repairs     |
| `user-data`                      | on request, hourly sweep | user data export zips and their expiry                                  |
| `contribution-points`            | on change                | users' contribution points (votes, hidden comments, posts, suggestions) |
| `notification-fanout`            | on announcement          | deliver an announcement to every user's inbox                           |
| `notification-trim`              | daily 03:30              | trim old inbox rows                                                     |
| `discord-webhook`                | on event                 | Discord announcements                                                   |
| `pdf-render`                     | on request               | statement PDFs (Playwright)                                             |
| `polygon-import`                 | on request               | Polygon package import and sync (includes Test generation requests)     |
| `polygon-autosync`               | every 10 min             | enqueue the automatic Syncs that are due                                |
| `problem-package`                | on request, daily 04:15  | problem package zip; the sweep trims the package cache                  |
| `problem-purge`                  | daily 03:30              | purge the heavy data of deleted problems, leave the tombstone           |
| `problem-databytes`              | once                     | measure data, statement and material sizes for the storage quota        |
| `source-check`                   | on upload                | compile an uploaded checker or interactor on a judge                    |
| `permission-rename` (boot)       | every worker start       | carry renamed permission codenames over to roles and users              |
| `ie-override-cleanup` (boot)     | every worker start       | move an overridden internal error's message into its revision           |
| `contest-summary-cleanup` (boot) | every worker start       | turn old JSON contest summaries into format options                     |

## Where to change what

| To change                                                                                      | Look in                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An HTTP endpoint                                                                               | `apps/api/src/modules/<feature>/<sub-feature>/` (controller, service, `dto/`); register it in the feature's `*-api.module.ts` (flat modules such as `events/`, `tags/`, `judges/` use their own module file)                                                           |
| Who can see/edit a problem or contest                                                          | `modules/problems/core/problem-access.ts`, `modules/contests/core/contest-access.ts`                                                                                                                                                                                   |
| A contest scoring format                                                                       | `libs/contests/src/formats/<kebab-case-name>.ts` and `registry.ts`                                                                                                                                                                                                     |
| Contest viewer fields (list `viewer`, detail `viewerResult`, `solverCount`)                    | `modules/contests/core/contest-viewer.service.ts`, `core/contest-problem-facts.service.ts`, `core/solver-counts.service.ts`, `core/viewer-problem-results.ts`                                                                                                          |
| Contest register/join/leave refusal codes                                                      | `modules/contests/participation/participation-refusals.ts`                                                                                                                                                                                                             |
| Who can see/administer an organization                                                         | `modules/organizations/core/organization-access.ts`                                                                                                                                                                                                                    |
| Who can see/edit a blog post                                                                   | `modules/blog/core/blog-access.ts`                                                                                                                                                                                                                                     |
| Which comment pages a viewer may read (and comment page types)                                 | `modules/comments/core/comment-pages.service.ts`                                                                                                                                                                                                                       |
| Votes, contribution points                                                                     | `modules/contributions/`, `libs/community/src/contribution.ts`, job in `apps/worker/src/jobs/contribution-points`                                                                                                                                                      |
| Homepage data, RSS/Atom feeds                                                                  | `apps/api/src/modules/home/`                                                                                                                                                                                                                                           |
| Code similarity                                                                                | `modules/similarity/`, job in `apps/worker/src/jobs/similarity`, language families in `similarity-languages.ts`                                                                                                                                                        |
| Discord webhooks                                                                               | `libs/community/src/discord.ts`, `DiscordWebhooksService` (`libs/community`, api and worker), job in `apps/worker/src/jobs/discord-webhook`                                                                                                                            |
| Who can see/edit a ticket                                                                      | `modules/tickets/core/ticket-access.ts` (list filter: `ProblemAccess.editableFilter`)                                                                                                                                                                                  |
| Ticket events (SSE) and Discord texts                                                          | `modules/tickets/streams/`, `libs/community/src/ticket-events.ts`, `libs/community/src/tickets.ts`                                                                                                                                                                     |
| Flatpages, misc config                                                                         | `modules/site/`                                                                                                                                                                                                                                                        |
| User activity capture and its staff API                                                        | `modules/user-activity/capture/`, `modules/user-activity/staff/`, rules in `libs/community/src/user-activity.ts`                                                                                                                                                       |
| Org PP, ranks, interaction gate, comment and blog rules                                        | `libs/community/src`                                                                                                                                                                                                                                                   |
| Rating                                                                                         | `libs/contests/src/rating/elo-mmr.ts`, job in `apps/worker/src/jobs/contest-rating`                                                                                                                                                                                    |
| Points, PP, problem stats                                                                      | `libs/judging/src/points.ts`, `apps/worker/src/jobs/submission-effects`                                                                                                                                                                                                |
| Judge protocol, dispatch, grading                                                              | `apps/bridge/src/{link,dispatch,judges,submissions}`                                                                                                                                                                                                                   |
| SSE channels and limits                                                                        | `apps/api/src/modules/events/`, channel services under `submissions/streams` and `contests/announcements`                                                                                                                                                              |
| Auth, sessions, permissions                                                                    | `libs/auth/src`, flows in `modules/auth/<flow>/`; new permissions in `libs/auth/src/principal/permissions.ts`                                                                                                                                                          |
| Markdown rendering                                                                             | `libs/render/src` (goldens in `src/fixtures`)                                                                                                                                                                                                                          |
| `init.yml`, zip handling, data files                                                           | `libs/problems/src`, routes in `modules/problems/data`                                                                                                                                                                                                                 |
| Submission read access (who sees a submission's list row, detail, source)                      | `modules/submissions/core/submission-access.ts` (rules), `SubmissionsService` (facts, list filter)                                                                                                                                                                     |
| Users, by audience: own account, public page, staff list, staff edit, staff create, ban, roles | `modules/users/{profile,pages,admin,editing,creation,moderation,access}/` (own data export: `data/`)                                                                                                                                                                   |
| Tags, problem types, problem groups, permission groups                                         | voted Tags: `modules/tags/`; organization problem tags: `modules/organizations/problem-tags/`; contest tags: `modules/contests/tags/`; Problem types and groups: `modules/problems/catalog/`; permission groups: `libs/auth/src/groups/`. See GLOSSARY, Classification |
| Polygon Import and Sync                                                                        | `modules/problems/polygon/` (routes, link options), `apps/worker/src/jobs/polygon-import/`, `polygon-autosync/`, `libs/problems/src/polygon/`                                                                                                                          |
| Test generation (tests built on a judge)                                                       | worker `jobs/polygon-import/test-generation.service.ts`, bridge `apps/bridge/src/generations/`                                                                                                                                                                         |
| A bridge command (api to bridge)                                                               | contract and parser `libs/judging/src/bridge-commands.ts`, sender `bridge-commands.service.ts`, receiver `apps/bridge/src/dispatch/commands.service.ts`                                                                                                                |
| Deploy, release, nginx, quadlets                                                               | `deploy/RUNBOOK.md` (start at "How a change reaches production")                                                                                                                                                                                                       |
| A Mongo schema                                                                                 | `libs/database/src/schemas/` (register in `SCHEMAS`)                                                                                                                                                                                                                   |
| A background job                                                                               | `apps/worker/src/jobs/<job>/` and its queue contract in `libs/<lib>/src/queues.ts`                                                                                                                                                                                     |
| Env variables                                                                                  | `libs/common/src/env/`, `.env.example`                                                                                                                                                                                                                                 |
| A runtime setting (admin-editable)                                                             | one entry in `libs/settings/src/registry.ts`; admin API in `modules/settings/`                                                                                                                                                                                         |
| OpenAPI schemas                                                                                | `dto/*.response.ts`; `libs/common/src/openapi/`                                                                                                                                                                                                                        |

## Deploy

A release is a merged Version PR: tag, CI-gated image build, then `qhhoj-deploy` on the host. The chain, with file names, and the common changes (memory cap, env var, nginx) are the first two sections of [deploy/RUNBOOK.md](deploy/RUNBOOK.md); CONTRIBUTING.md has "Releasing" and "Env and deploy".

## More

- [CONTRIBUTING.md](CONTRIBUTING.md): layout, patterns, naming (code identifiers), testing, per-area rules, deploy notes
- [GLOSSARY.md](GLOSSARY.md): domain words and what not to call them
- [scripts/README.md](scripts/README.md): what each script folder does
- [docs/decisions.md](docs/decisions.md): design decisions and why
