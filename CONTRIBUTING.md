# Contributing

## Stack

- Node 22, TypeScript 5 (`tsconfig.json`, CI uses Node 22)
- NestJS 11 on Fastify (`@nestjs/platform-fastify`)
- Mongoose 8 via `@nestjs/mongoose`; MongoDB 8 **replica set** (change streams)
- Redis >= 7 (the rate limiter uses `EXPIRE ... NX`), MariaDB 11 (legacy source for the migrator only)
- Jest 29 + `mongodb-memory-server`; ESLint + Prettier
- Render stack pins: `markdown-it` 15.0.2, `katex` 0.19.0, `sanitize-html` 2.17.5 (2.17.6+ pulls ESM-only `htmlparser2@12`, breaks Jest CJS; do not bump), `@fastify/multipart` 10.1.2
- Versions pinned in `package.json`; `fastify` pinned via `overrides` to a single copy; bump when `@nestjs/platform-fastify` or an advisory requires it
- Jobs: `bullmq` 5.81.5 + `@nestjs/bullmq` 11.0.5 (12 is ESM-only; do not bump)
- `playwright` 1.63.0 (Chromium: `npx playwright install --with-deps chromium`), `yaml` 2.9.1 (dev), `yauzl` 3.4.0 / `yazl` 3.3.1, `saxes` 6.0.0 (`fast-xml-parser` 5 is ESM-only)
- Worker image: `pandoc` >= 3, util-linux `prlimit` (pandoc runs under `prlimit --as=768MiB`; without it conversion fails closed), Chromium
- Local services: `docker-compose.yml` (`mongo`, `redis`, `mariadb`, `mailpit`); env vars in `.env.example`

## Layout

```
apps/
  api/        HTTP app (Fastify): AppModule, main.ts, health.controller.ts
  migrator/   CLI (nest-commander): MariaDB -> MongoDB backfill/verify
  worker/     BullMQ jobs: jobs/<job>/<job>.module|processor|service|repository.ts (pdf-render, polygon-import, submission-effects, effects-sweep, problem-rescore, contest-rescore, contest-final-judge)
  bridge/     judge TCP server (DMOJ protocol): protocol/, dispatch/, judges/, submissions/, bridge.service.ts
libs/
  common/     http layer (AppError, filter, interceptor, pipe), bootstrap, BaseMongoStreamQuerier, `runCoalesced`
  database/   uuid helpers, schema helpers, SCHEMAS, DatabaseModule
  auth/       groups, password, token, session, principal, users, guards, decorators, crypto, AuthModule
  problems/   init.yml compiler, zip reader, problem data and PDF cache file services, statement helpers, queue contracts (`queues.ts`)
  judging/    scoring, points/PP formulas (`points.ts`), queue contracts (`queues.ts`: submission-graded, problem-rescore, effects-sweep), bridge commands + `BridgeCommandsService`, submission events + `SubmissionEventsService`, `notifyGraded`/`notifyRescore`
  contests/   contest time windows, standings and ranking cache keys, queue contracts (`queues.ts`: contest-rescore, contest-final-judge), one module per format in `formats/` (registry in `formats/registry.ts`)
  render/     Markdown -> HTML (markdown-it, KaTeX, sanitizer); pure functions, golden fixtures in src/fixtures
test/fixtures/  legacy MariaDB dump (legacy.sql, django.json)
tools/legacy/   regenerates the fixtures
```

- Aliases: `@libs/common`, `@libs/database`, `@libs/auth`, `@libs/render`, `@libs/problems`, `@libs/judging`, `@libs/contests` (and `@libs/<name>/*`) -> `libs/<name>/src`
- Import from the alias root (`@libs/database`) except `/testing` entry points
- Each lib exports through `libs/<name>/src/index.ts`; add new files there

## Feature module pattern

```
<feature>/
  <feature>.module.ts
  <feature>.controller.ts     HTTP only: parse DTO, call service, return value
  <feature>.service.ts        business logic
  <feature>.querier.ts        in-memory reads (see below)   | one of these
  <feature>.repository.ts     Mongoose reads/writes         | per data source
  dto/<name>.dto.ts           request/response shapes (class-validator)
```

- Flow: `controller -> service -> querier | repository`
- File names: `<feature>.<role>.ts`, role in `controller|service|querier|repository|events|guard|decorators|module|schema|dto|mapper|command|filter|interceptor|pipe|error|processor|handler|spec`
- One exported responsibility per file; subdocument classes and small helper types may live with their owner
- Scope: a file exporting a class is `<name>.<role>.ts` with role = class suffix (`IdMapRepository` -> `id-map.repository.ts`); function/type modules and entry points (`main.ts`, `index.ts`, `testing.ts`, `uuid.ts`, `schema.ts`, `crypto.ts`, `mapper.ts`, `bootstrap.ts`) use a plain noun
- Exception: `pipes/validation.pipe.ts` exports `validationPipe` (default instance) and `createValidationPipe(overrides)`, not a class
- Tests: unit specs `<file>.spec.ts` next to the file under test; app e2e specs in `apps/<app>/test/*.e2e-spec.ts`, library e2e specs next to their file (e.g. `libs/common/src/http-layer.e2e-spec.ts`)
- Schemas are shared: `libs/database/src/schemas/<entity>.schema.ts` (not per feature)
- Jobs: `@Processor(QUEUE[, { concurrency }]) extends WorkerHost` (`processor` = BullMQ consumer in `apps/worker`; env-driven concurrency is set in `onApplicationBootstrap`), one module per job; queue names and job data types live in `libs/problems/src/queues.ts` (problem jobs) and `libs/judging/src/queues.ts` (`submission-graded`, `problem-rescore`, `effects-sweep`) and `libs/contests/src/queues.ts` (`contest-rescore`, `contest-final-judge`)
- `handler`: one instance per judge socket (`apps/bridge/src/judges/judge.handler.ts`)
- `QueueModule` (`@libs/common`) is the BullMQ root; feature modules add `BullModule.registerQueue({ name })`; connection options are a plain `{ url }`, never the shared `REDIS` client
- Reference: `libs/auth/src/groups/` (module + querier + spec)
- `<feature>.events.ts`: in-process `EventEmitter` wrapper for notifying other modules (`problem.events.ts`)

## Querier vs repository

| | Querier | Repository |
|---|---|---|
| Data | small, simple, read often, never deleted | everything else |
| Storage | in-memory copy | Mongoose queries |
| Freshness | change stream + cron resync | always live |
| Base | `BaseMongoStreamQuerier` | `@InjectModel` |

- Reference: `libs/common/src/querier/base-mongo-stream.querier.ts`, `libs/auth/src/groups/groups.querier.ts`
- Whole-collection queriers extend `BaseCatalogQuerier` (reference: `apps/api/src/modules/problems/languages.querier.ts`)
- Querier shape: `onModuleInit` -> `resync()` -> `setupMongoStream(model, pipeline, onChange)` -> `forceResyncQuerier(resync, cron)`
- Streams need a replica set; `DISABLE_MONGODB_STREAM=true` turns them off
- Queriers never handle deletes (stream only forwards insert/update/replace)

## HTTP conventions

| Case | Return / throw | Wire format |
|---|---|---|
| Single | value | `{ data }` |
| List | `new Paginated(items, meta)` | `{ data, meta }` |
| Legacy shape | `@RawResponse()` on handler/class | body as returned |
| Error | `throw new AppError(code, status, message, fields?)` | `{ error: { code, message, fields? } }` |

- Wrapping/unwrapping lives in `libs/common/src/interceptors/response.interceptor.ts`; errors in `filters/exception.filter.ts`
- Nest `HttpException` < 500 maps to codes `unauthorized|forbidden|not_found|rate_limited|http_error`; anything else is `internal_error`
- Validation: DTO classes + class-validator; global pipe is whitelist + forbid unknown + transform, failure -> `validation_failed` (400) with `fields`
- Query DTOs: `@Type(() => Number)` for numbers; `dto/transforms.ts` (`toArray`, `toBoolean`) for arrays and booleans
- Repeated filters are sent as `typeIds=a&typeIds=b`, never `typeIds[]`
- Multipart routes read `request.parts({ limits: { files: 1, fields: 0, fileSize } })`, check for a single file and the expected fieldname, and never declare `@Body()`; an oversized file is `file_too_large` 413
- Multipart helpers: `problems/multipart.ts` (`readMultipartFile` buffers, `saveMultipartFile` streams to a path); per-call `limits` override the plugin default
- Raw file responses: `@RawResponse()` + `@Res({ passthrough: true })` (the PDF route uses plain `@Res()` to keep its 202)
- App wiring: `configureApp(app)` + `fastifyAdapter()` from `@libs/common` (used by `main.ts` and tests)

## Auth

- Every route is authenticated by default (global `AuthGuard`); opt out with `@Public()`
- Decorators: `@AllowPartialAuth()` (before 2FA), `@AllowPwnedPassword()`, `@SessionOnly()` (Bearer -> 403 `forbidden`; used on password change, token regenerate, logout-all, the 2FA enrol/disable/credential routes and impersonation start/stop), `@NoImpersonation()` (403 `forbidden` while impersonating; 2FA enrol/disable/credential routes, password change, token regenerate), `@RequirePermission('judge.<codename>')`, param `@CurrentAuth()` -> `AuthContext`
- Origin rule: unsafe methods without a Bearer header must carry no `Origin` or exactly the `SITE_URL` origin, else 403 `csrf_failed`; checked first, even on `@Public` routes. The session cookie is re-issued once a day while the session is active
- Guard order: Origin check -> authenticate (Bearer, else session cookie; an invalid Bearer token is rejected 401 even on `@Public` routes) -> cookie refresh -> `@Public` exit -> `unauthorized` -> `@SessionOnly` -> CSRF (`csrf_failed`) -> 2FA (`two_factor_required`) -> pwned password (`password_change_required`) -> `@NoImpersonation` (`forbidden`) -> permission (`forbidden`)
- Error codes: `unauthorized` 401, `invalid_credentials` 401 (login) / 400 (password change), `csrf_failed` 403, `two_factor_required` 403, `password_change_required` 403, `forbidden` 403, `banned` 403, `account_not_activated` 403, `rate_limited` 429, `validation_failed` 400, `conflict` 409, `not_found` 404, `not_impersonating` 400, `invalid_token` 400 (activation/reset/social token), `invalid_code` 400 (TOTP/scratch code), `totp_not_enabled` 400, `webauthn_not_enabled` 400, `webauthn_failed` 400, `mail_unavailable` 503, `pdf_unavailable` 503 (statement PDF render failed; carries `Retry-After`; the SPA polls `GET /problems/:code/pdf` no faster than every 3 s and stops on 503)
- SPA contract: cookie `qhhoj_session`; send `X-CSRF-Token` (from `/auth/me` or login) on POST/PUT/PATCH/DELETE
- API tokens (Bearer) skip the CSRF, 2FA and pwned-password gates but cannot reach `@SessionOnly()` routes; the token stays valid across a password change (design choice)
- Login rate limiting is reserve-then-release, per IP plus per resolved account; unknown usernames are limited per NFKC-lowercased name
- Behind nginx set `TRUST_PROXY` to its address (e.g. the container network CIDR); otherwise every client shares one IP and the per-IP limits (login, streams) become global
- `@fastify/cookie` is pinned at 11.0.2: 11.1.1+ depends on ESM-only `cookie` 2, which breaks Jest CJS; do not bump
- New permissions: add the codename to `libs/auth/src/principal/permissions.ts`
- Account flows live in `apps/api/src/modules/auth/<flow>.controller.ts` + `<flow>.service.ts` + `dto/` (registration, password-reset, totp, webauthn, social, impersonation); add new flows the same way and list their paths in `apps/api/test/openapi.e2e-spec.ts`
- Mail goes through the `MAILER` token (`@libs/common`): SMTP via `SMTP_URL`/`MAIL_FROM` (Mailpit in dev), `InMemoryMailer` in tests; a send failure is `mail_unavailable` 503
- Uploads go through `StorageService` (`@libs/common`): files live under `MEDIA_ROOT` (a volume nginx serves at `MEDIA_URL`), paths are checked to stay inside it, and callers never pass client-supplied names unsanitised; file type is decided from the bytes
- Deploy requirement for the nginx `/media` location: send `X-Content-Type-Options: nosniff`; `/media/materials/` uses `default_type application/octet-stream` and `Content-Disposition: attachment`; `/media/images/` and `/media/materials/` add `Content-Security-Policy: sandbox`
- Frontend routes embedded in mails/redirects (SPA contract): `/activate/<key>`, `/reset-password/<token>`, `/login`, `/login/2fa`, `/register/social?token=<token>`, `/`
- Registration: usernames `^\w+$` (max 30), email unique case-insensitively (checked in code); activation keys are stored as sha256 hashes
- 2FA enrolment (`totp/enroll`, `webauthn/register/options`) and removing a WebAuthn credential require `currentPassword` and share the `password-confirm` failure budget; WebAuthn registration and login use separate session challenges
- Password reset also works for active accounts with an unusable (`!`) hash (migrated social-only users): it sets their first password; the token is bound to the stored hash, so it is single-use either way
- Rate limits for guarded attempts use `RateLimitService.reserve(keys, limit, windowSeconds)`: it hits first, throws `rate_limited` over the limit, and returns a `release()` to call on success (only failures consume budget); all limit/window constants live in `auth/rate-limits.ts`. The password-reset per-email limit (3/hour) is never released, an accepted trade-off
- Second factor: TOTP and WebAuthn share one budget (10 failures/900 s, 50/day); completing it sets `lastLogin` and `twoFaPassed`. TOTP secret and scratch codes are encrypted at rest (`encrypt(..., encryptionKey(env.encryptionKey))`). WebAuthn does not require user verification
- `SessionData` goes through Redis cjson: no integers of 15+ digits (precision loss), no arrays, absent values are `null` (`undefined` is dropped); keep values to strings, booleans, `null` and small numbers
- Single-use session fields (`pendingTotpSecret`, `webauthnChallenge`) are read only via `SessionService.consume(id, field)`
- Social login (`GET /auth/social/{google|facebook|github}/start|callback`, `POST /auth/social/complete`): a provider is enabled when both `<PROVIDER>_CLIENT_ID` and `_CLIENT_SECRET` are set; state is bound to the browser by the `oauth_state` cookie, and the signup continuation by the `oauth_pending` cookie (set by the callback, must equal the `complete` token, else 400 `invalid_token` without spending it); `start` is limited to 30 per IP per 600 s. Stored legacy provider names: `google-oauth2`, `facebook`, `github-secure`
- Impersonation (`POST /auth/impersonate/{userId}`, `/stop`): active superusers only, never onto a superuser or nested; `lastLogin` is untouched; the guard rechecks the impersonator on every request and ends the session if they lost superuser rights; credential routes are `@NoImpersonation()`
- Test overrides: `setupApiTest({ overrides: [{ provide, useValue }] })` (the harness already swaps `MAILER` for an `InMemoryMailer`); clear `rate:*` Redis keys in tests that need a fresh budget
- OpenAPI: `GET /api/internal/openapi.json` (raw JSON, no auth)

## Problems

- Layout: `apps/api/src/modules/problems/` (`/api/internal/problems`), `modules/api-v2/` (`/api/v2`), rendering in `libs/render`
- File names: reads are `problems.*`, write flows are `problem-<flow>.*` (`problem-editing`, `problem-uploads`)
- Rules live in `ProblemAccess` (`problem-access.ts`): `canSee`, `canEdit`, `visibleFilter`
- `visibleFilter` goes only inside `find`/`count`, never an aggregate
- Public routes: `@Public()` + `@CurrentAuth()` + `optionalPrincipal(auth)`; invisible or unknown problem -> 404, visible but not editable -> 403
- Events (`ProblemEvents`): `pointsChanged`, `publicityChanged`, `codeRenamed`, `statementChanged`; listeners run synchronously after the write
- Rate limits: `problems/rate-limits.ts`
- Rendering styles: `problem`, `problem-full`, `solution`; one `styleOf` picks the style per problem
- HTML is rendered and stored at save; reads never render
- `problem-full` HTML is unsanitized; writing statement text on a full-markup problem needs `judge.problem_full_markup`
- Markdown is capped at 200000 chars (`MAX_MARKDOWN_LENGTH`); render budgets per render: 2000 formulas of at most 1000 chars and 1.5 MB of KaTeX output (excess stays as source text), 200000 opening tags, nesting depth 500, 2 MB of HTML; past the tag, depth or HTML limit `renderMarkdown` throws `RenderLimitError` -> 400 `validation_failed` on the rendered field
- Math: `$..$` (no space inside the edges, so money is safe), `~..~` (spaces allowed), `$$..$$`; use `\vert` instead of `|` in table-cell math; math inside raw HTML blocks is not rendered
- Legacy `<blockquote class="spoiler">` works only at column 0 after a blank line
- Golden fixtures: `libs/render/src/fixtures/*.md|html`; regenerate with `UPDATE_GOLDENS=1 npx jest libs/render/src/goldens.spec.ts`, review the diff; listed in `.prettierignore`
- Uploads: type is sniffed from the bytes; SVG max 512 KiB, 20000 tags, nesting depth 1000; materials use an extension allow-list
- Text index: `await model.init()` in fixtures before `$text` queries
- `/api/v2`: legacy Django envelope (`api_version`, `method`, `fetched`, `data`/`error`); unknown query params are ignored; an invalid Bearer token is 403 `login required`

## Problem data

- `Problem.data` subdocument + `compileInitYaml` (`libs/problems`): sorted keys, `feedback` instead of `errors`, per-case `bridged` rejected, custom checker args composed from the uploaded source
- Volume: `PROBLEM_DATA_ROOT/<code>/` flat (`init.yml`, archive, sources); Polygon packages stage in `PROBLEM_DATA_ROOT/.imports/`
- Routes (`/api/internal/problems/:code/data`): `GET`/`PUT` (8 MiB body, 300 cases, 9999 with `judge.create_mass_testcases`), `GET init`, `POST archive` (.zip, 512 MiB), `POST files/:kind` (`generator|customChecker|customGrader|customHeader`, 1 MiB), `DELETE files/:kind` (those plus `archive`), `GET files/:name` (attachment, `nosniff`)
- Source extensions: generator `cpp cc c pas java py`, customChecker `cpp pas java`, customGrader `cpp`, customHeader `h`
- Zip bounds (`ZIP_LIMITS`): 25000 entries, 2 GiB total, 512 MiB per entry, ratio 1100; no symlinks, control characters or Unicode-path mismatch
- `isManuallyManaged` problem -> 404 on data routes except `GET files/:name`; mirror problem -> 403 on writes
- Rename: pre-check, then the `codeRenamed` listener moves the directory (and drops cached PDFs)
- A rename while an import of that problem is in flight fails that import (the worker's compare-and-set filters on `code`)
- Materials: `MEDIA_ROOT/materials/<problemId>/`
- PDF: `GET /:code/pdf` -> 200 file, 202 `rendering`, 503 `pdf_unavailable`; cache `PDF_CACHE_ROOT/<code>.<lang>.pdf`, dropped on `statementChanged` / `codeRenamed`; job id `pdf-<code>-<lang>`, `removeOnComplete: true`, `removeOnFail` kept 10 min (503 + `Retry-After` meanwhile)
- Polygon import (`judge.import_polygon_package`): options in the query string; `POST /problems/imports` 202 `{ jobId }` (package <= 512 MiB, 10 per hour per user), `GET /problems/imports/:jobId` (requester or superuser); job retained 24 h
- Import semantics: create defaults for catalog fields; update keeps catalog fields, points and authors unless given; every option comes from the job (no prompts); tests repacked as `tests.zip`; images re-hosted; a compile error fails the job before the DB write; the case limit is the requester's (300, or 9999 with `judge.create_mass_testcases`); the worker finds the package at `.imports/<jobId>.zip` and refuses a manually managed or mirror target
- Tags (`/api/internal/tags`, `catalog`, `:code`, `:code/assign`): tagging needs `allowTagging` plus `judge.add_tagproblem` or rating >= 1900; link presets (Codeforces, CodeforcesGym, Atcoder, VNOJ, Kattis); no external OJ calls

## Judging

- Collections: `submissions` (`cases` is `select: false`, at most 10000), `submissionSources` (`_id` = submission id, at most 65536 code points, counted by `codePointLength`), `judges` (`authKeyHash` = sha256 of the key; online fields written only by the bridge)
- Statuses QU P G D IE CE AB, and PD (final-submission contest rows: stored, not sent to a judge, requeued at priority 3 when the contest ends); results add AC WA TLE MLE OLE IR RTE SC RJ; priorities 0 contest, 1 normal, 2 rejudge, 3 batch rejudge, FIFO by id within one
- Queue truth is Mongo: queued = `status QU`; the bridge claims QU -> P before sending; every judge packet's write filters `{ _id, judgedOn, status }`
- API -> bridge: Redis stream `bridge:commands` (`judge`, `abort`, `disconnect-judge`, `disable-judge`), fire-and-forget via `BridgeCommandsService`; a lost `judge` command waits for the bridge's resync (`resyncMs`, 30 s), which also reconciles connected judges with Mongo (blocked, rotated key, `isDisabled`); `abort` is best-effort, the user aborts again
- Bridge -> effects: one `submission-graded` BullMQ job per finished (D/CE/IE/AB) or rejected submission, enqueued through `notifyGraded` (1 s bound, a failure is logged and skipped, in the bridge and the api)
- Bridge start: bind the port (judges wait), judges offline, P/G -> QU, stream position, queue rebuild, commands, resync, then serve judges. Stop: dispatching stops first so P/G survive for the next start
- Start and resync requeue P/G rows without spending `requeueCount` (resync: only rows no connected judge held on two consecutive ticks)
- Judge disconnect in flight: requeued once (`requeueCount`), IE the second time; a rejudge restores the allowance
- Packets: 4 MiB compressed / 8 MiB inflated before authentication (`HANDSHAKE_LIMITS`; any packet but `handshake` closes the connection), 8 MiB / 32 MiB after; JSON nesting depth 16; 1000 packets/s; 15 s absolute handshake deadline, 60 s silence (paused while a packet is handled), 20 s acknowledgement; 10000 cases; case text in UTF-8 bytes (clipped: 512 output/extended feedback, 50 feedback); 64 KiB logs (clipped); 256 sockets, 8 unauthenticated per remote address
- Packet handling: a packet for another submission is logged and ignored; only a wrong `submission-acknowledged` fails the judge's own submission (IE) and closes; `grading-end`, `test-case-status`, `batch-*` are ignored until `grading-begin`
- Dispatch: lowest load among free candidates, random tie-break; a rejudge never takes the last free candidate when another judge could; mirrors dispatch under `mirrorRoot`'s code; `languageLimits` override limits; `short-circuit = !partial`
- Submit: visible problem, allowed non-file-only language, not banned (superuser exempt), `judgeId` (a judge name) for editors and only to an online judge with the problem; 20 per minute per user; 2 unfinished (429 `rate_limited`) unless `judge.spam_submission`, counted under a fail-fast `withRedisLock` (`libs/common`; contention -> 409)
- Detail/source: problem visible (else 404), then legacy `can_see_detail` (`F` follows `all-solved`); cases by `testcaseResultVisibility` (A all, B batches, S none; superusers all), feedback for superusers/editors/`allowViewFeedback`, output unless `testcaseVisibility` O (editors always); IE messages for editors only; the list (`GET /api/internal/submissions`) is public over visible problems, and IE/QU/P/G/D/SC filters are staff-only (400)
- Actions: invisible problem -> 404; abort (owner unless rejudged, or `judge.abort_any_submission`), rejudge/reject (`judge.rejudge_submission`/`judge.reject_submission` + edit rights; 409 while unfinished; rejudge: while in flight or locked), bulk rejudge per problem (more than 10 needs `judge.rejudge_submission_lot`, locked only with `force`; counts first, then streams chunks of at most 1000 ids)
- Judges admin (`judge.change_judge`): `/api/internal/judges`; keys are shown once; rotate and block force-disconnect

## Effects and realtime

- Every recompute of a user's points or a problem's stats goes through `SubmissionEffectsService` (worker); recomputes read Mongo and `$set`, never increment. `runCoalesced` (`libs/common`) serialises one key across processes, extends its lock while the work runs, and reruns once more for every mark left meanwhile, so bursts collapse
- Formulas (`libs/judging/src/points.ts`): user points over public, non-org-private problems (best per problem, > 0, descending; PP = sum of 0.98514^rank * points over the first 300, + 0.05 per solved); solved = AC with `casePoints >= caseTotal` (`IS_SOLVED`); problem stats exclude unlisted users, AC = `result AC` and `points >= problem.points`
- `submission-effects` consumes `submission-graded` (concurrency 4; the user only for public, non-org-private problems); the job is enqueued with 3 attempts and exponential backoff (10 s); `submission-effects`, `effects-sweep` and `problem-rescore` start consuming only after the submissions indexes exist (`startAfterIndexes`)
- Sweep: job scheduler every 10 min, global concurrency 1; recomputes users and problems with `judgedDate` or `date` in the window from the last watermark (`effects:sweep:until`, set only after a successful sweep; at most 24 h back) minus a 10 min overlap
- Rescore: `problem-rescore {problemId}` (no `jobId`, 3 attempts) on `pointsChanged` (points, partial, org privacy) and `publicityChanged` in the api and after a Polygon update in the worker; one at a time; rows with status D except RJ, read through a cursor, written in 1000-row `bulkWrite`s whose filter repeats the case totals read (a rejudge that finished meanwhile keeps its points); then every user with such a row and the problem's stats
- Rescore points use `submissionPoints` (`round(casePoints / caseTotal * points, 3)`, as at grading end); legacy's rescore rounded the ratio first
- `viewerStatus` (`solved | attempted | null`) on problem list/detail: one aggregate per page (`ViewerStatusRepository`)
- Events: Redis pub/sub `submission-events` (`SubmissionEventsService`), fire-and-forget (1 s bound, skipped while Redis is not ready), ids and status only, published by whoever writes the status. Bridge: `processing` when the request is sent to the judge, `grading-begin`, `test-case` (at most 4/s per submission), `done`, requeues as `queued`. Api: submit/rejudge -> `queued`, abort of a queued submission and reject -> `done`; bulk rejudge publishes nothing
- SSE: `GET /api/internal/events/submissions/:id` (detail rules; `state` first, read after the stream is registered; `test-case` only when every case result is visible; `resync` after a lost subscription) and `GET /api/internal/events/submissions` (public feed: public, non-org-private problems, no progress); one subscriber connection per api process
- Stream limits (`submissions/rate-limits.ts`, per api process): 8 per user, 16 per IP, 5000 total, 1000 feed; a client is dropped when a write stays undrained or the backlog stays above 16 KiB for 2 s in total, or at once above 256 KiB; 15 s heartbeat; access (session, user, detail rules) re-checked every 60 s
- `/api/v2/submissions` (oldest first; totals only with `user` or `problem`) and `/api/v2/submission/:id` (login, `can_see_detail`; cases follow the problem's case visibility, stricter than legacy)

## Contests

- Layout: `apps/api/src/modules/contests/` (`/api/internal/contests`), formats and ranking helpers in `libs/contests`, worker jobs `contest-rescore` and `contest-final-judge`
- Collections: `contests` (problems embedded, `accessCodeHash` sha256, `bannedJudges` judge names), `contestParticipations` (`virtual`: 0 live, -1 spectate, n virtual; `isRegistered` until the first join; live and frozen results), `contestSubmissions` (`_id` = submission id, points scaled to the contest problem); `users.currentParticipation`
- Rules live in `ContestAccess` (`contest-access.ts`): `canSee`, `canEdit`, `visibleFilter`, scoreboard and `canSeeFullSubmissionList` checks; viewer facts come from `ContestViewerService`; invisible or unknown contest -> 404 (also a malformed key), state conflicts -> 409
- Current participation is checked on read (`CurrentContestService.current`): ended or invisible contest -> pointer cleared (compare-and-set). Its scope feeds `ProblemAccess.canSee/visibleFilter`: before the start every problem is hidden, after it the contest's problems are visible. `/api/v2` applies no contest scope (legacy parity)
- Formats: a `ContestFormat` (`parseConfig`, `score`, `firstSolveTime`) in `libs/contests/src/formats/<name>.ts`, registered in `FORMATS` (`registry.ts`); names `default ioi ioi16 icpc vnoj ultimate final_submission`; scored through `scoreParticipation(rows, { name, config }, context)`; configs are camelCase, validated on every write (400 `formatConfig`); `labelStyle` (`numeric|alpha`) replaces legacy Lua label scripts
- Freeze (`icpc`, `vnoj` only): absolute, contest end - `frozenLastMinutes`, and it stays after the end; an editor unfreezes by setting `frozenLastMinutes` to 0. Non-editors get only frozen fields and cells (`standingOf`, never mixed with live ones) in rankings and participations, own row included; editors always see live data
- Submit inside a current contest that lists the problem: priority 0, `lockedAfter` for live participations, pretests flag, `maxSubmissions` (IE and PD excluded) checked under the per-user lock; FSO submissions skip the unfinished limit; a running FSO contest stores `PD`: no bridge command, no event. The bridge reads banned judges, pretests and `in-contest` from Mongo at load and claim
- Effects: `SubmissionEffectsService.applyContest` rescales the contest submission (`contestSubmissionPoints`), `recomputeParticipation` (coalesced per participation) rewrites results and drops the four ranking keys
- Rescore: `contest-rescore {contestId}` (no `jobId`, one at a time) runs on `POST /:key/rescore`, disqualifications, problem rescores, and contest edits that change `scoringOf` (editing service): format, format config, `startTime`, `endTime`, `frozenLastMinutes`, `pointsPrecision`, or the problems' id, points, partial or order. Every edit purges the ranking keys; other edits do not rescore
- Ranking (`GET /:key/ranking`): one indexed read of the contest's rows, sorted in memory (`compareStandings`, competition ranks 1, 1, 3; ties in participation id order), cached per `{withVirtual, frozen}` for `scoreboardCacheTimeout` s with single-flight builds per api process; editors, own-row boards (viewer may not see the full board) and a 0 timeout bypass the cache
- Submission lists: `GET /:key/submissions` filters by contest and shows everyone's rows only when `canSeeFullSubmissionList` (never during a freeze unless editor), else the viewer's own (403 for another `user`). Other users' submissions of contests whose full list the viewer may not see leave `/api/internal/submissions`, `/api/v2/submissions` and the detail (403)
- FSO (`final_submission`): delayed job `final-judge-<contest>-<endTime ms>` rescheduled on create and edit, one-minute sweep over contests holding `PD` rows, `POST /:key/judge-final` (ended FSO contests only, else 409; ignores `autoJudge`); each run is serialised per contest, requeues each `PD` row once at priority 3 and skips rows rejected with `RJ`; a single rejudge of a `PD` row is 409; leaving `final_submission` while rows are `PD` is 409
- Access codes (`contests/rate-limits.ts`): wrong codes 10 per user and 30 per IP per 10 min on join and register (a missing code and a right one cost nothing); editors skip the code; virtual numbering retried up to 10 times
- Disqualify (`POST /:key/participations/:id/disqualify`, `{ disqualified }`): scores -9999 (frozen fields too), bans or unbans the user from the contest, clears the current pointer, queues a rescore. `CONTEST_BAN_AFTER_DISQUALIFICATIONS` (0 = off) bans the account (`isActive` false, `isUnlisted`) at that many disqualifications outside organisation-private contests; lifting uses compare-and-set on the ban reason
- Legacy migration (migrator requirement): `formatConfig` keys `last_score_altering` -> `lastScoreAltering`, `auto_judge` -> `autoJudge`, `LSO` -> `lso`; drop `cumtime` on `final_submission`; format name `Ultimate` -> `ultimate`; Lua label scripts become `labelStyle`
- Deviations from legacy: `ultimate` takes the latest row (no double count on equal dates), writes its tiebreaker and rounds its score; FSO final judging requeues `PD` rows only; no fifth ranking sort key (`-submission_count`); frozen results never reach non-editors through `/api/v2` (legacy leaked them)

## Data conventions

- `tagGroups`/`tags` are querier-backed; `tagProblems` is a repository
- `Problem.data` and `dataVersion` are projected out of lists and reset on clone
- `_id` is a UUIDv7: declare `@IdProp() _id!: string`
- Helpers (`@libs/database`): `newId()` new id string, `uuidStr(value)` Binary -> hex string, `toUuid(id)` string -> BSON `UUID` for raw driver queries
- UUID arrays on hydrated docs (`user.groups`, ...): index access, spread and `toJSON()` give strings, but `.map/.filter/.flatMap/.slice` give raw buffers; map through `uuidStr` first
- `@Schema({ ...baseSchemaOptions, collection: '<name>' })`: timestamps, no `__v`, `toJSON` returns `id` instead of `_id`
- Case-insensitive unique fields: `ciIndex(Schema, 'field')` and query with `.collation(CI)` (see `libs/database/src/schema.spec.ts`); `ciIndex(schema, field, unique = true)`, e.g. `ciIndex(UserSchema, 'email', false)` for non-unique
- Catalog collections (languages, licenses, problem types and groups) are querier-backed and never deleted
- `submissions`, `submissionSources` and `judges` are repository-backed
- Register every schema in `SCHEMAS` (`libs/database/src/schemas/index.ts`) and export it there

## Backfill jobs (migrator)

Work on the migrator is paused; the framework exists.

- Build first (`npx nest build migrator`), then `node dist/apps/migrator/main backfill [jobs...] [--fresh]`: idempotent upsert by `_id`; `--fresh` empties each selected collection first
- `node dist/apps/migrator/main verify [jobs...]`: compares Mongo vs MariaDB, exit code 1 on mismatch
- Ids are stable: legacy `table:id` -> UUIDv7 stored in `migrationIdMap` (`apps/migrator/src/id-map.repository.ts`)

Add a job:

1. `apps/migrator/src/mappers/<collection>.mapper.ts`: `@Injectable() class <Name>Mapper implements Mapper<Row>` (template: `groups.mapper.ts`)
2. Set `name`, `collection`, `refTables` (legacy tables whose ids it resolves, incl. its own), `sql` (**must `ORDER BY` the primary key**)
3. `map(row, ctx)` returns `{ _id: ctx.ref(table, row.id)!, ... }`; use `ctx.ref|refs|date|bool|json`; no `undefined` (use `null`/`[]`)
4. Extra lookups go in `prepare(source)`; non-deterministic fields (random-IV ciphertext) are replaced in `normalize(doc)`
5. Add the class to `ORDER` in `apps/migrator/src/mappers/index.ts` (dependency order)

## Naming and style

- Meaningful names; no single-character identifiers (variables, params, lambda args, catch vars); lint `id-length` min 2
- Prefer full words over abbreviations (`replSet`, `testingModule`)
- YAGNI, DRY, KISS; one-liners when equally readable
- Same shape for every instance of a pattern (every mapper looks like `groups.mapper.ts`)
- Formatting is Prettier through ESLint: `npx eslint --fix <files>`

## Testing

- Unit: `<file>.spec.ts` next to the file under test; e2e: `apps/<app>/test/*.e2e-spec.ts` for apps, next to the file for libs
- Mongo: `startMongo()` from `@libs/database/testing` (in-memory replica set)
- HTTP: `createTestApp(moduleMetadata)` from `@libs/common/testing` (same pipes/filters/interceptor as prod)
- The whole `npm test` needs Redis (`TEST_REDIS_URL`, default db 15, which tests flush); migrator e2e also needs MariaDB (`TEST_MYSQL_URL`): `podman compose up -d mariadb redis` (or `docker compose`)
- Bridge e2e: `setupBridgeTest` (`apps/bridge/test/setup.ts`, millisecond `FAST_TIMINGS`, `restart()`), `FakeJudge` (real TCP), `RecordingJudge` (no socket); api specs read the command stream through `apps/api/test/submission-fixtures.ts`
- Index use is asserted with `profileQueries` (`@libs/database/testing`): no `COLLSCAN`, documents examined bounded; worker effects fixtures in `apps/worker/test/effects-fixtures.ts`; SSE through `apps/api/test/sse-client.ts` (supertest cannot read streams); `recordSubmissionEvents` (`@libs/judging/testing`)
- Worker: `setupWorkerTest` (`apps/worker/test/setup.ts`); zip fixtures via `buildZip` from `@libs/problems/testing`; `TEST_ENV` lives in `@libs/common/testing`
- Playwright specs skip without Chromium; the pandoc spec skips locally and fails in CI without pandoc
- Legacy fixtures in `test/fixtures/` are generated, never hand-edited: `tools/legacy/run.sh` (`CONTAINER=docker` to override podman)

## Commands

| Command | Purpose |
|---|---|
| `npm test` | Jest, runs in band |
| `npm run format` | Prettier write on `apps/` and `libs/` |
| `npm run lint` | ESLint (+ Prettier) on `apps/` and `libs/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | build `api` |
| `npx nest build migrator` | build migrator |
| `npx nest build worker` | build worker |
| `npx nest build bridge` | build bridge |
| `npx nest start api` | run the API |
| `npx nest start bridge` | run the bridge |
| `npx nest start worker` | run the worker (from the repo root: KaTeX's CSS resolves from `node_modules`) |

CI (`.github/workflows/ci.yml`): lint, typecheck, test, all four builds.

## Env and deploy

- `PROBLEM_DATA_ROOT`, `PDF_CACHE_ROOT` are required by the api, the worker and the bridge (all validate env); the migrator reads only `MONGO_URL` and `LEGACY_*`
- The api and the worker share `MEDIA_ROOT`, `PROBLEM_DATA_ROOT`, `PDF_CACHE_ROOT`
- `PROBLEM_DATA_ROOT` and `PDF_CACHE_ROOT` must not be under `MEDIA_ROOT` (served publicly)
- Worker memory limit: about 2 GB x job concurrency (Chromium, pandoc)
- Bridge: `JUDGE_BRIDGE_HOST`, `JUDGE_BRIDGE_PORT` (default 9999); exactly one instance
- The bridge port must be reachable only from judge hosts (firewall)
- Judge containers need a restart policy (the judge-server fork exits on a broken connection)
- The qhhoj/judge-server fork must handle submission ids (UUID strings) as strings everywhere: the `%d` of the grading `Process` name in `judge.py` is fatal, `%d` in `packet.py`/`judge.py` log calls and the `int` annotations of `Submission.id`/`abort_grading` are not; the bridge is not deployable until it does
- Streams: nginx must not buffer `/api/internal/events/` (`proxy_buffering off`; the api also sends `X-Accel-Buffering: no`) and needs `proxy_read_timeout` well above the 15 s heartbeat
- Worker tuning: `PDF_RENDER_TIMEOUT_MS`, `PDF_MAX_BYTES`, `PDF_CONCURRENCY`; the Polygon import queue runs one job at a time

## Commits

- One-line conventional subject: `feat: ...`, `fix: ...`, `docs: ...`, `refactor: ...`, `test: ...`, `chore: ...`
