# Contributing

Why things are the way they are: [docs/decisions.md](docs/decisions.md).

## Stack

- Node 22, TypeScript 5 (`tsconfig.json`, CI uses Node 22)
- NestJS 11 on Fastify (`@nestjs/platform-fastify`)
- Mongoose 8 via `@nestjs/mongoose`; MongoDB 8 **replica set** (change streams)
- Redis >= 7 (the rate limiter uses `EXPIRE ... NX`)
- Jest 29 + `mongodb-memory-server`; ESLint + Prettier
- Render stack pins: `markdown-it` 15.0.2, `katex` 0.19.0, `sanitize-html` 2.17.5 (2.17.6+ pulls ESM-only `htmlparser2@12`, breaks Jest CJS; do not bump), `@fastify/multipart` 10.1.2
- Versions pinned in `package.json`; `fastify` pinned via `overrides` to a single copy; bump when `@nestjs/platform-fastify` or an advisory requires it
- Jobs: `bullmq` 5.81.5 + `@nestjs/bullmq` 11.0.5 (12 is ESM-only; do not bump)
- `playwright` 1.63.0 (Chromium: `npx playwright install --with-deps chromium`), `yaml` 2.9.1 (dev), `yauzl` 3.4.0 / `yazl` 3.3.1, `saxes` 6.0.0 (`fast-xml-parser` 5 is ESM-only)
- Worker image: official static `pandoc` >= 3 (not the Debian/Ubuntu package: it fails with "failed to create OS thread" under the cap), util-linux `prlimit` (pandoc runs under `prlimit --as=768MiB`; without it conversion fails closed), Chromium
- `@dodona/dolos-lib` 3.5.1 (code similarity; ESM-only, so the worker runs it in a child process; V8 heap cap 2 GiB, native parser memory is bounded by the container; `npm ci` compiles its tree-sitter grammars with node-gyp, so the worker image and CI need `python3`, `make`, `g++`)
- Local services: `docker-compose.yml` (`mongo`, `redis`, `mailpit`); env vars in `.env.example`

## Layout

```
apps/
  api/        HTTP app (Fastify): AppModule, main.ts, health.controller.ts, modules/ (see "Feature module pattern" for the folders), seed/ (`npm run seed:e2e`)
  worker/     BullMQ jobs and boot routines: jobs/<job>/<job>.module|processor|service|repository.ts, one folder per job (the list is the README "Jobs" table); shared helpers `jobs/lazy-zip.ts`, `jobs/start-after-indexes.ts`
  bridge/     judge gRPC server (qhhoj.judge.v1): link/ (server, sessions, messages, FetchSource), dispatch/ (slots, grace, dispatcher, commands), judges/, submissions/ (claims, run writes, runs), generations/ (test generation), external/ (external judge runs), bridge-core.module.ts, bridge.service.ts
libs/
  common/     http layer (AppError and its subclasses, filter, interceptor, pipes), bootstrap, env, BaseMongoStreamQuerier, `runCoalesced`, AES-GCM helper (`crypto/`), time zones (`text/time-zone.ts`), OpenAPI helpers (`openapi/`), mail contract (`Mailer`, `MAILER`, `InMemoryMailer`)
  database/   uuid helpers, schema helpers, SCHEMAS, DatabaseModule
  settings/   runtime settings: `registry`, `setting-types`, `sealing`, `settings.querier`, `settings.service`, `settings.module`, `testing` (`fakeSettings`)
  auth/       groups, password, token, session, principal, users, guards, decorators, legacy Fernet `crypto` (no AES), AuthModule
  problems/   init.yml compiler, zip reader, problem data and PDF cache file services, statement helpers, Polygon contracts (`polygon/`), queue contracts (`queues.ts`)
  judge-proto/ the vendored qhhoj.judge.v1 contract and its generated TypeScript (see Judge protocol)
  judging/    scoring, points/PP formulas (`points.ts`), queue contracts (`queues.ts`: submission-graded, problem-rescore, effects-sweep, similarity), bridge commands + `BridgeCommandsService`, submission events + `SubmissionEventsService`, `notifyGraded`/`notifyRescore`
  contests/   contest time windows, standings and ranking cache keys, queue contracts (`queues.ts`: contest-rescore, contest-final-judge, contest-rating, contest-data; `replay-queue.ts`: contest-replay and its coalescing `requestReplayBuild`), `balloons`, `feed-events`, `contest-export`, replay events and ghost scoring (`replay-events`, `ghost-replay`, `ghost-gap`), Elo-MMR (`rating/elo-mmr.ts`), contest events, data paths, one module per format in `formats/` (registry in `formats/registry.ts`)
  community/  org PP, ranks, interaction gate, user-data paths, comment paths and pages, blog post rules, contribution formula, Discord payloads, tickets (limits, Discord texts), ticket-events contract, flatpage urls, user activity rules (session keys, user agent classifier, CSV cells), queue contracts (`queues.ts`: organization-points, user-data, contribution-points, discord-webhook), notifications (drafts, event contract, queues, repository, service, module)
  render/     Markdown -> HTML (markdown-it, KaTeX, sanitizer, `blog` style); pure functions, golden fixtures in src/fixtures
deploy/       production: nginx, podman quadlets, `qhhoj-deploy`, CI deploy scripts, backups, judge host packaging copies; start at `deploy/RUNBOOK.md`
scripts/      helper scripts, one line per folder in `scripts/README.md`
test/fixtures/  django.json (Django password hashes and Fernet secrets for the auth specs)
tools/legacy/   elo_mmr_goldens.py
```

- Layer order (no cycles): `database` <- `common` <- `settings` <- `auth` <- every other lib and app
- Aliases: `@libs/common`, `@libs/database`, `@libs/settings`, `@libs/auth`, `@libs/render`, `@libs/problems`, `@libs/judging`, `@libs/contests`, `@libs/community` (and `@libs/<name>/*`) -> `libs/<name>/src`
- Import from the alias root (`@libs/database`) except `/testing` entry points
- Each lib exports through `libs/<name>/src/index.ts`; add new files there
- Lib or app: a lib holds what more than one process reads (queue contracts, schemas, access rules, pure formulas); an app holds what only that process does. Pure single-app code lives in a lib only when it is a domain rule (rating, scoring), never for I/O helpers. When a second process needs a file, move it to the lib then (`ProblemAccess` moved to `libs/problems` for the worker; notifications and `SUBMISSION_FILE_DIR` followed the same rule; see docs/decisions.md)

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
- Size: a module stays flat until about 15 files; past that, group by feature into subfolders (each with the pattern above and its own `dto/`), keeping the `<x>-api.module.ts` at the module root. Shared helpers (rate-limits, shared DTOs) live in `core/`

```
contests/
  contests-api.module.ts
  core/            contests.*, participations.repository, contest-viewer, current-contest, contest-access(.module), rate-limits, dto (params, detail, list, queued)
  participation/   join, register, virtual, disqualify
  ranking/         board, ranking links, official ranking
  rating/          rate endpoint, ratings.repository
  announcements/   announcements, contest-events (SSE pushes)
  stats/  data/  submissions/  best/  bulk/  problem-ops/  publish/  tags/
  balloons/        balloons.* (queue, deliver, undeliver)
  feed/            feed.* (NDJSON snapshot and stream), feed-keys.* (mint, revoke, release), feed-auth, README (verdict table)
  export/          contest-export.* (request, status, download)
  editing/         create/update, clone
  ghosts/          ghosts.* (staff CSV import, list, csv download, delete), ghost-csv
  replay/          replay.* (GET replay chunks, POST rebuild), replay-access, replays.repository
problems/
  problems-api.module.ts
  core/            list/detail, repository, access, search, events, rescore, revisions, rate-limits, multipart, shared dto
  catalog/         languages, licenses, groups, types queriers
  editing/         create/edit, policy, statement (translations, editorial, preview), clone
  data/            test data (store, upload, lifecycle, write guard)
  imports/  pdf/  uploads/  bulk/  external-judge/  lifecycle/  package/  polygon/  quota/
submissions/
  submissions-api.module.ts
  core/            list/detail, repository, access, rate-limits
  create/  actions/  streams/  batch/  best/
auth/
  auth-api.module.ts
  core/            login/session/password change, rate-limits
  registration/  password-reset/  impersonation/
  social/          flow + OAuth providers
  two-factor/      second factor, totp, webauthn
organizations/
  organizations-api.module.ts
  core/            access rules, repositories (organizations, members, requests), points refresh, rate-limits, dto
  editing/  membership/  requests/  creation/  submissions/
  problem-tags/  problems/  usage/  quota/   each folder's `wiring.ts` holds an array of its classes: add a class there, never to `organizations-api.module.ts`
users/
  users-api.module.ts
  core/            listed-users, rate-limits, shared dto (username param, time zone)
  pages/  leaderboards/  profile/  moderation/  data/  suggestions/
  admin/           staff user list (`judge.ban_user`): username prefix search, `banned` filter, never e-mail
  editing/         staff edit of one user: profile and moderation fields (`judge.change_profile`), e-mail, active flag, password set, reset link, rename (`auth.change_user`)
  creation/        staff account creation, single and batch (`auth.add_user`)
  access/          roles and permissions: catalog, role list/create/edit, a user's groups, direct permissions and flags (read with `judge.change_profile`, write superuser only)
blog/
  blog-api.module.ts
  core/            BlogAccess (blog-access.ts), BlogAccessModule (posts repository + visibility, imported by comments), lists, detail, organization posts, dto
  editing/  votes/  drafts/
  moderation/      staff lists of hidden and scheduled posts (`judge.edit_all_post`)
comments/
  comments-api.module.ts
  core/            CommentPagesService (the one page-access decision), threads, counts, locks, post-block rule, comment markup, recent comments, rate-limits, dto
  posting/  votes/  moderation/  reports/
settings/          flat: admin settings API (`GET`/`PATCH /api/internal/admin/settings`)
mail/              flat: `SmtpMailer` behind the `MAILER` token
contributions/     flat: vote ledger (votes.repository), vote gates and limit, contribution-points enqueuer
similarity/        core/ start/ runs/ pairs/: code-similarity runs and pairs (`judge.moss_contest` + edit rights)
home/              flat: homepage data, RSS/Atom feeds
audit/             flat: staff change log (`GET /admin/audit`)
events/            flat: the SSE hub (`EventStreamHub`), stream limits; channels register from their own modules
judges/            flat: judge list, runtimes page, staff judge administration
tags/              flat: voted problem tags (`tags`, `tag-groups`, `tag-problems`)
tickets/
  tickets-api.module.ts
  core/            TicketAccess (ticket-access.ts), tickets.service, ticket-gate.service (muted users), repository, context (access view, links), responses, rate-limits, dto
  posting/         file a ticket (problem, general), messages
  editing/         PATCH: open/close, good, notes, assignees
  streams/         TicketEventsService (publish), ticket streams (SSE)
  canned/          staff canned replies (CRUD, change_ticket)
  alerts/          summary count, ticket inbox alerts (TicketNotificationsService), staff lookup
notifications/
  notifications-api.module.ts
  core/            inbox endpoints (list, unread-count, read, read-all), inbox repository and service, rate-limits, dto
  streams/         the `events/user` channel (notification nudges), own module
site/
  site-api.module.ts
  public/          flatpages and misc config queriers, `GET /site`
  admin/           staff CRUD for flatpages and misc config
user-activity/
  user-activity.module.ts
  capture/         onResponse hook, buffer, writer, live visitors store
  staff/           logs, summary, CSV export, live, deletes (`judge.can_see_user_activity`)
```

- File names: `<feature>.<role>.ts`, role in `controller|service|querier|repository|store|events|guard|decorators|module|schema|dto|command|filter|interceptor|pipe|error|processor|oauth-provider|spec`
- A class is named after its file: `<Name><Role>` in `<name>.<role>.ts` (`ContestEditFieldsService` in `contest-edit-fields.service.ts`), so a `*.service.ts` class always ends in `Service`
- One exported responsibility per file; subdocument classes and small helper types may live with their owner
- Scope: a file exporting a class is `<name>.<role>.ts` with role = class suffix (`IdMapRepository` -> `id-map.repository.ts`); function/type modules and entry points (`main.ts`, `index.ts`, `testing.ts`, `uuid.ts`, `schema.ts`, `crypto.ts`, `bootstrap.ts`) use a plain noun
- Exception: `pipes/validation.pipe.ts` exports `validationPipe` (default instance) and `createValidationPipe(overrides)`, not a class
- Tests: unit specs `<file>.spec.ts` next to the file under test (a spec that needs MongoDB or Redis is `<file>.db.spec.ts`, see Testing); app e2e specs in `apps/<app>/test/*.e2e-spec.ts`, library e2e specs next to their file (e.g. `libs/common/src/http-layer.e2e-spec.ts`)
- Schemas are shared: `libs/database/src/schemas/<entity>.schema.ts` (not per feature)
- Jobs: `@Processor(QUEUE[, { concurrency }]) extends WorkerHost` (`processor` = BullMQ consumer in `apps/worker`; env-driven concurrency is set in `onApplicationBootstrap`), one module per job; queue names and job data types live in `libs/problems/src/queues.ts` (problem jobs) and `libs/judging/src/queues.ts` (`submission-graded`, `problem-rescore`, `effects-sweep`, `similarity`) and `libs/contests/src/queues.ts` (`contest-rescore`, `contest-final-judge`, `contest-rating`, `contest-data`) and `libs/community/src/queues.ts` (`organization-points`, `user-data`, `contribution-points`, `discord-webhook`)
- `QueueModule` (`@libs/common`) is the BullMQ root; feature modules add `BullModule.registerQueue({ name })`; connection options are a plain `{ url }`, never the shared `REDIS` client
- Reference: `libs/auth/src/groups/` (module + querier + spec)
- `<feature>.events.ts`: in-process `EventEmitter` wrapper for notifying other modules (`problem.events.ts`)

## Querier vs repository

|           | Querier                                  | Repository       |
| --------- | ---------------------------------------- | ---------------- |
| Data      | small, simple, read often, never deleted | everything else  |
| Storage   | in-memory copy                           | Mongoose queries |
| Freshness | change stream + cron resync              | always live      |
| Base      | `BaseMongoStreamQuerier`                 | `@InjectModel`   |

- Reference: `libs/common/src/querier/base-mongo-stream.querier.ts`, `libs/auth/src/groups/groups.querier.ts`
- Whole-collection queriers extend `BaseCatalogQuerier` (reference: `apps/api/src/modules/problems/catalog/languages.querier.ts`)
- Querier shape: `onModuleInit` -> `resync()` -> `setupMongoStream(model, pipeline, onChange)` -> `forceResyncQuerier(resync, cron)`
- Streams need a replica set; `DISABLE_MONGODB_STREAM=true` turns them off
- Queriers never handle deletes (stream only forwards insert/update/replace)

## Runtime settings

- Env keeps infrastructure and key material: `MONGO_URL`, `REDIS_URL`, `ENCRYPTION_KEY`, `TOKEN_SECRET`, `SESSION_SECRET`, `SESSION_KEY_MIGRATION`, `SITE_URL`, `PORT`, `LOG_LEVEL`, `TRUST_PROXY`, `SSE_IP_ALLOWLIST`, `COOKIE_SECURE`, `MEDIA_ROOT`, `MEDIA_URL`, `PROBLEM_DATA_ROOT`, `PDF_CACHE_ROOT`, `CONTEST_DATA_ROOT`, `USER_DATA_ROOT`, `PDF_CONCURRENCY`, `JUDGE_BRIDGE_HOST`, `JUDGE_BRIDGE_PORT`, `JUDGE_BRIDGE_TLS_CERT`, `JUDGE_BRIDGE_TLS_KEY`, `TEST_REDIS_URL`
- Settings (the admin edits them, no restart): every key is one entry in `libs/settings/src/registry.ts`; read the list there, it is the only copy
- Add one: a `define({ type, default, description, secret, combine? })` entry in `SETTINGS` (`libs/settings/src/registry.ts`), `type` from `setting-types.ts` (add a type there when none fits); no other file changes, the admin API and revisions pick it up. `secret: true` encrypts the whole value, `secret: ['clientSecret']` those top-level fields; `combine` merges a PATCH into the stored object (the `auth.*` clients), without it the patch replaces the value
- Read: inject `SettingsService` and call `settings.get('<key>')` where the value is used, never cache it (it is a synchronous read of an in-memory snapshot kept fresh by change stream plus a one-minute resync, so a change reaches api, worker and bridge within seconds); a consumer that builds something expensive keys it by the value (the mailer keeps its SMTP transport per URL)
- Write: only `SettingsService.set(key, patch, actorId)` (one transaction: combine, validate, seal, upsert, revision); over HTTP `GET /api/internal/admin/settings`, `PATCH /api/internal/admin/settings/:key` with `{ value }`, `GET .../:key/revisions`, `POST .../:key/revisions/:revisionId/restore` (writes the revision's `before` back as a new revision; a whole-secret key answers 409 `secret_unrestorable`, and sealed fields are never restored), all needing `judge.change_settings` (grant it to superusers only, it can point the server at outbound URLs). `null` is refused: clear with `{}` (webhooks), `''` (URLs, SMTP) or `enabled: false`
- A stored value that cannot be read (corrupt row, rotated `ENCRYPTION_KEY`) falls back to the default and the process keeps booting
- Secrets (`mail.smtpUrl`, `discord.webhooks`, each `clientSecret`) are returned by `GET` as `{ set: true }` only, the registry `default` is redacted the same way, stored sealed, redacted in revisions (`changedFields` names what changed); never log or echo a value, and a `SettingError` message never contains the input
- Webhook and pwned URLs must be https (`isSafeUrl`); `http` is accepted for `localhost`/`127.0.0.1` outside production; in production `localhost` and literal loopback/private/link-local IPs are refused. `mail.smtpUrl` is not guarded: it may point at an internal relay by design (accepted residual, like hostnames that resolve to internal addresses)
- Tests: `api.setSetting(key, value)` / `worker.setSetting(key, value)` on the harnesses; unit specs build `fakeSettings({ key: value })` from `@libs/settings/testing`; the api harness switches the pwned-password check off (`auth.pwnedApiUrl` is `''`)

## HTTP conventions

| Case         | Return / throw                                                         | Wire format                                                |
| ------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------- |
| Single       | value                                                                  | `{ data }`                                                 |
| List         | `new Paginated(items, meta)`                                           | `{ data, meta }`                                           |
| Legacy shape | `@RawResponse()` on handler/class                                      | body as returned                                           |
| Error        | `throw new AppError(code, status, message, fields?, headers?, extra?)` | `{ error: { code, message, fields?, issues?, ...extra } }` |

- Wrapping/unwrapping lives in `libs/common/src/interceptors/response.interceptor.ts`; errors in `filters/exception.filter.ts`
- Nest `HttpException` < 500 maps to codes `unauthorized|forbidden|not_found|payload_too_large|rate_limited|http_error`; anything else is `internal_error`
- Validation: DTO classes + class-validator; global pipe is whitelist + forbid unknown + transform, failure -> `validation_failed` (400) with `fields` (messages per field, unchanged) and `issues`
- `issues: [{ field, code, message }]` is the machine-readable twin of `fields`, built from one list by `ValidationFailedError` (or derived by `AppError` when `fields` is given, code `invalid`); codes are snake_case: the failing constraint name (`max_length`, `is_in`), or `context: { code: '...' }` on the class-validator decorator (`username_invalid_characters`, `email_invalid`), or the code a service gives (`invalidField(field, message, code)`, `ValidationFailedError`): `username_taken`, `email_taken`, `password_pwned`, `organization_unavailable`, `language_unknown`, `language_takes_file`, `language_takes_text`, `file_upload_disabled`, `language_extension_invalid`, `file_wrong_extension`, `scratch_project_invalid`, `must_not_be_null` (a PATCH field that may not be null), `password_incorrect`, `password_unchanged`, `assignee_unknown`, `invalid_url`, `invalid_path`, `invalid_regex`, `parent_unknown`, `parent_cycle`; nested DTO fields use dotted names (`appearance.glass`)
- `extra` (6th `AppError` argument) is merged into the error object next to `code` and `message`, never overriding them; `BannedError` (login) uses it for `banReason`
- Contest participation refusals (`participation-refusals.ts`): 409 `editor_cannot_register`, `registration_not_required`, `registration_closed`, `contest_ended`, `already_registered`, `contest_not_started`, `virtual_disallowed`, `not_registered`; 403 `banned_from_contest`, `access_code_required`, `wrong_access_code`; 404 `not_in_contest`; 400 `rules_not_accepted` (field `acceptRules`, a contest with rules and a new participation without the box ticked)
- Contest admin refusals: 400 `confirmation_mismatch` (delete without the key typed again), 409 `contest_not_deletable` (visible, rated, pending final submissions, or participations without `judge.edit_all_contest`), 409 `already_participating`, `participation_has_submissions` and `banned_from_contest` (hand-edited participations), issue `user_unknown`
- Contest replay refusals (`replay/replay-refusal.ts`, every one carries `issues[].code`): 403 `forbidden` with issue `board_frozen` or `board_hidden`; 409 `contest_not_ended`, `replay_unsupported`, `replay_changed`; 400 `replay_build_required`; 404 `replay_chunk_not_found`, `replay_not_ready` (also when Redis is down on the lazy path), `not_found`; 429 `rate_limited`; 503 `replay_unavailable` (rebuild while Redis or the queue is down; the budget is given back)
- Contest ghost refusals (`ghosts/`): 400 `ghost_import_invalid` with `issues[].code` from `GHOST_CSV_ISSUE_CODES` (`label_missing`, `label_formula`, `label_repeats`, `label_invalid`, `caption_invalid`, `caption_formula`, `control_character`, `cell_invalid`, `columns_mismatch`, `header_invalid`, `csv_invalid`, `too_many_ghosts`; `row` is the 1-based CSV row); 409 `ghost_unsupported_format` (import into a `final_submission` contest); 413 from Fastify's body limit (`GHOST_CSV_MAX_BYTES`, 1 MiB) before the handler runs
- A hidden board is 403 `forbidden` with issue `board_hidden` everywhere (contest replay, sync standings); match on the issue code, not the error code
- Query DTOs: `@Type(() => Number)` for numbers; `dto/transforms.ts` (`toArray`, `toBoolean`, `trim`) for arrays, booleans and search strings
- UUID fields (body, query, path): `@LowercaseUuid() @IsUUID('7')` (`@libs/common`); ids compare as the lowercase strings `uuidStr` gives, so an uppercase id must arrive lowercased. Keep `@IsUUID` itself on the property (the swagger plugin reads it for `format: uuid`); `apps/api/src/uuid-fields.spec.ts` fails for a UUID field without it
- Admin list paging: `/api/internal/admin/users` takes `pageSize` (<= 100) and caps `page` at 500 (skipping is linear); the other new admin lists and the public organization list use fixed sizes with `page` <= 10000
- Repeated filters are sent as `typeIds=a&typeIds=b`, never `typeIds[]`
- Multipart routes read `request.parts({ limits: { files: 1, fields: 0, fileSize } })`, check for a single file and the expected fieldname, and never declare `@Body()`; an oversized file is `file_too_large` 413
- Multipart helpers: `problems/core/multipart.ts` (`readMultipartFile` buffers, `saveMultipartFile` streams to a path); per-call `limits` override the plugin default
- Raw file responses: `@RawResponse()` + `@Res({ passthrough: true })` (the PDF route uses plain `@Res()` to keep its 202)
- App wiring: `configureApp(app)` + `fastifyAdapter()` from `@libs/common` (used by `main.ts` and tests)

## Auth

- Every route is authenticated by default (global `AuthGuard`); opt out with `@Public()`
- Decorators: `@AllowBeforeTwoFactor()` (before 2FA), `@AllowPwnedPassword()`, `@SessionOnly()` (Bearer -> 403 `forbidden`; used on password change, token regenerate, logout-all, the 2FA enrol/disable/credential routes incl. the key list, the scratch-code count and impersonation start/stop), `@AllowSuperuserToken()` (on a `@SessionOnly()` route, also admits a superuser's API token; only `PATCH admin/users/{username}/access`), `@NoImpersonation()` (403 `forbidden` while impersonating; 2FA enrol/disable/credential routes incl. the key list and the scratch-code count, password change, token regenerate, the personal data export request and download), `@RequirePermission('judge.<codename>')`, param `@CurrentAuth()` -> `AuthContext`
- Origin rule: unsafe methods without a Bearer header must carry no `Origin` or exactly the `SITE_URL` origin, else 403 `csrf_failed`; checked first, even on `@Public` routes. The session cookie is re-issued once a day while the session is active
- Guard order: Origin check -> authenticate (Bearer, else session cookie; an invalid Bearer token is rejected 401 even on `@Public` routes) -> cookie refresh -> `@Public` exit -> `unauthorized` -> `@SessionOnly` -> CSRF (`csrf_failed`) -> 2FA (`two_factor_required`) -> pwned password (`password_change_required`) -> `@NoImpersonation` (`forbidden`) -> permission (`forbidden`)
- Error codes: `unauthorized` 401, `invalid_credentials` 401 (login) / 400 (password change), `csrf_failed` 403, `two_factor_required` 403, `password_change_required` 403, `forbidden` 403, `banned` 403 (login; `banReason` is a member of the error object), `account_not_activated` 403, `rate_limited` 429, `validation_failed` 400, `conflict` 409, `not_found` 404, `not_impersonating` 400, `invalid_token` 400 (activation/reset/social token), `invalid_code` 400 (TOTP/scratch code), `totp_not_enabled` 400, `webauthn_not_enabled` 400, `webauthn_failed` 400, `banned_from_problem` 403, `contest_submission_limit` 403, `unfinished_submission_limit` 429, `solve_first` / `contest_running` / `hidden` 403 (submission detail and source: solve the problem first; the contest's list is not open yet; no access), `mail_unavailable` 503, `pdf_unavailable` 503 (statement PDF render failed; carries `Retry-After`; the SPA polls `GET /problems/:code/pdf` no faster than every 3 s and stops on 503)
- SPA contract: cookie `qhhoj_session`; send `X-CSRF-Token` (from `/auth/me` or login) on POST/PUT/PATCH/DELETE
- API tokens (Bearer) skip the CSRF, 2FA and pwned-password gates but cannot reach `@SessionOnly()` routes, except a superuser's token on an `@AllowSuperuserToken()` route; the token stays valid across a password change (design choice)
- Login rate limiting is reserve-then-release, per IP plus per resolved account; unknown usernames are limited per NFKC-lowercased name
- Behind nginx set `TRUST_PROXY` to its address (e.g. the container network CIDR); otherwise every client shares one IP and the per-IP limits (login, streams) become global; `SSE_IP_ALLOWLIST` (IPs/CIDRs, matched against that client IP) raises the live-stream cap from 16 to 512 for a school lab behind one NAT
- `@fastify/cookie` is pinned at 11.0.2: 11.1.1+ depends on ESM-only `cookie` 2, which breaks Jest CJS; do not bump
- New permissions: add the codename to `libs/auth/src/principal/permissions.ts`; legacy Django names are kept as they are (`judge.add_language`, `judge.change_language`, `flatpages.change_flatpage`); v2-only codenames so far include `judge.change_contest_tag` (contest tag catalogue), `judge.delete_problem`, `judge.manage_short_link`, `judge.manage_integration`, `judge.change_settings`
- 429 from `RateLimitService.reserve` carries `Retry-After`: the longest TTL among the keys over their limit (at least 1 s); under-limit keys never extend it
- Account flows live in `apps/api/src/modules/auth/<flow>/<flow>.controller.ts` + `<flow>.service.ts` + `dto/` (registration, password-reset, social); totp and webauthn share `auth/two-factor/` (`totp.controller.ts`, `webauthn.controller.ts`, `second-factor.service.ts`) and `impersonation/` has no `dto/`; add new flows the same way and list their paths in `apps/api/test/openapi.e2e-spec.ts`
- Mail goes through the `MAILER` token (`@libs/common`; `SmtpMailer` in `apps/api/src/modules/mail/`): SMTP from the `mail.smtpUrl` setting, sender `mail.from`, both read per message (a new URL gets a new transport, the old one is closed); `InMemoryMailer` in tests; a send failure, or no `mail.smtpUrl` set, is `mail_unavailable` 503
- Uploads go through `StorageService` (`@libs/common`): files live under `MEDIA_ROOT` (a volume nginx serves at `MEDIA_URL`), paths are checked to stay inside it, and callers never pass client-supplied names unsanitised; file type is decided from the bytes (exception: a file submission keeps its language's extension, which `LANGUAGE_EXTENSION_PATTERN` limits to `[a-z0-9]{1,10}`, as legacy did)
- Deploy requirement for the nginx `/media` location: send `X-Content-Type-Options: nosniff`; `/media/materials/` uses `default_type application/octet-stream` and `Content-Disposition: attachment`; `/media/images/` and `/media/materials/` add `Content-Security-Policy: sandbox`
- Frontend routes embedded in mails/redirects (SPA contract): `/activate/<key>`, `/reset-password/<token>`, `/login`, `/login/2fa`, `/register/social?token=<token>`, `/`, `/post/<id>`, `/problem/<code>`, `/problem/<code>/editorial`, `/contest/<key>`, `/tagproblem/<code>`, `/ticket/<id>`, `/user/<username>`, `#comment-<id>` (Discord links and feeds)
- Registration: usernames `^\w+$` (max 30), email unique case-insensitively (checked in code); activation keys are stored as sha256 hashes; optional `organizationId` (an open, listed organization the account joins) and `languageId` (its default language), each refused with an issue code when unknown or unavailable
- `GET /auth/username-available?username=` -> `{ available }` (public, 30 per 10 min per IP; a stale pending signup reads as available); `POST /auth/activate/resend { email }` -> 204 whatever the email (resends only to a pending account, replaces its activation keys; 10 per hour per IP, 3 per hour per email); `GET /auth/social/providers` lists the enabled providers
- Session shape (`GET /auth/me`, login): `SessionResponse { user, csrfToken, twoFactorRequired, twoFactor, passwordChangeRequired, impersonatorId }`; `user` carries `siteTheme`, `appearance` (null until set), `languageId` and `adminCapabilities` (object rights behind the admin screens, beside `permissions`); before the second factor `user` is null and `twoFactor` is `{ username, methods }` (`totp`, `webauthn`; empty when the factor was disabled meanwhile: sign in again). `siteTheme` defaults to `auto` for new accounts and must match `^[a-z][a-z0-9-]{0,31}$` (the SPA owns the theme ids)
- 2FA enrolment (`totp/enroll`, `webauthn/register/options`) and removing a WebAuthn credential require `currentPassword` and share the `password-confirm` failure budget; WebAuthn registration and login use separate session challenges; `GET 2fa/webauthn/credentials` lists `{ id, name }` in registration order (no credential id or public key); `register/verify` returns the same shape; `GET 2fa/totp/scratch-codes` → `{ remaining }` (400 `totp_not_enabled` when off)
- Password reset also works for active accounts with an unusable (`!`) hash (migrated social-only users): it sets their first password; the token is bound to the stored hash, so it is single-use either way
- Rate limits for guarded attempts use `RateLimitService.reserve(keys, limit, windowSeconds)`: it hits first, throws `rate_limited` over the limit, and returns a `release()` to call on success (only failures consume budget); all limit/window constants live in `auth/core/rate-limits.ts`. The password-reset per-email limit (3/hour) is never released, an accepted trade-off
- Second factor: TOTP and WebAuthn share one budget (10 failures/900 s, 50/day); completing it sets `lastLogin` and `twoFaPassed`. TOTP secret and scratch codes are encrypted at rest (`encrypt(..., encryptionKey(env.encryptionKey))`). WebAuthn does not require user verification
- `SessionData` goes through Redis cjson: no integers of 15+ digits (precision loss), no arrays, absent values are `null` (`undefined` is dropped); keep values to strings, booleans, `null` and small numbers
- Single-use session fields (`pendingTotpSecret`, `webauthnChallenge`) are read only via `SessionService.consume(id, field)`
- Social login (`GET /auth/social/{google|facebook|github}/start|callback`, `POST /auth/social/complete`): a provider is enabled by its `auth.google|facebook|github` setting (`enabled`, `clientId`, `clientSecret`) and disappears from `GET /providers` and 404s at start and callback the moment it is disabled; state is bound to the browser by the `oauth_state` cookie, and the signup continuation by the `oauth_pending` cookie (set by the callback, must equal the `complete` token, else 400 `invalid_token` without spending it); `start` is limited to 30 per IP per 600 s. Stored legacy provider names: `google-oauth2`, `facebook`, `github-secure`
- Impersonation (`POST /auth/impersonate/{userId}`, `/stop`): active superusers only, never onto a superuser or nested; `lastLogin` is untouched; the guard rechecks the impersonator on every request and ends the session if they lost superuser rights; credential routes and the personal data export are `@NoImpersonation()`
- Test overrides: `setupApiTest({ overrides: [{ provide, useValue }] })` (the harness already swaps `MAILER` for an `InMemoryMailer`); clear `rate:*` Redis keys in tests that need a fresh budget

## OpenAPI

- `GET /api/internal/openapi.json` (raw JSON, no auth) is the contract the frontend generates its types from; `docs/decisions.md` has why
- Response shapes are classes in `dto/*.response.ts`; the swagger CLI plugin (`nest-cli.json`) documents every `*.dto.ts` and `*.response.ts` from its types and comments, so a new route needs only its class, no decorators
- A paginated route returns `Paginated<Item, Meta>` and carries `@ApiPaginatedResponse(Item)` (`{ data: Item[], meta: PageMetaResponse }`); a list without a total returns `Paginated<Item, HasMorePageMetaResponse>` with `@ApiHasMoreResponse(Item)`, a cursor list `Paginated<Item, CursorPageMetaResponse>` with `@ApiCursorResponse(Item)` (the meta type keeps the value and the decorator in step; `meta-contract.openapi-e2e-spec.ts` checks the sent keys); `@ApiTextResponse(type)` documents a raw text route; `@RawResponse()` marks routes that bypass the `{ data }` envelope (files, feeds); `envelopeResponses` wraps every other 2xx JSON schema in `{ data }`
- Give `Record`, `unknown`, nullable-union and integer-bounded fields an explicit `@ApiProperty(...)` (the plugin cannot infer them); multipart bodies use `@ApiConsumes` + `@ApiBody`
- `npm run test:openapi` runs every `apps/api/test/openapi/*.openapi-spec.ts` under `test/jest/openapi.config.js`, which applies the plugin; plain jest cannot (the plugin reads types, so `isolatedModules` must be off) and the main suite ignores them. These specs are static (stubbed controllers, no MongoDB or Redis) and run in CI; the ones that boot the app (`openapi.e2e-spec.ts`, `*.openapi-e2e-spec.ts`) run locally with `npm run test:openapi:db` (`test/jest/openapi-db.config.js`, needs `TEST_REDIS_URL`). It fails for a JSON route without a response schema, an untyped parameter (`#/components/schemas/Object`), a bare object, a validated DTO property the document drops, a route without the `default` error response, or a shared enumeration spelled inline or under two names, so run it after adding or changing a route
- `openapi.json` at the repo root is the committed contract the frontend generates its types from. `npm run openapi:emit` rewrites it without starting a server or a database (controllers only, providers stubbed); CI (`openapi` job) fails, and prints the diff, when the committed file differs from a fresh emit. Run `npm run openapi:emit` and commit the file with every change that touches a DTO, a response class, a route or an enum
- A class property with an initializer needs its type written out (`page: number = 1`, plus `@ApiPropertyOptional()` for an optional query value): the plugin cannot infer it and writes `Object`. A property typed with an alias of a union (`score!: VoteScore`) needs an explicit `@ApiProperty({ enum, enumName })` or it is dropped; give the enum from a `const` array rather than a union type (readable, and the plugin's order for a union is unstable); the emit also sorts every `enum` list, so order never shows in the contract. An enumeration used in three or more places gets an `enumName`. Free-form JSON is `OPAQUE_JSON_OBJECT` or `ANY_JSON_VALUE`
- Never edit or hand-merge `openapi.json`. `.gitattributes` marks it `merge=binary`, so git never writes conflict markers into it: when two branches both changed it, re-emit after resolving the sources
- Files use `@ApiFileResponse('<content type>')` with `@RawResponse()`; server-sent event streams use `@ApiEventStream(...Frames)` where each frame class has `event` and `data`; an NDJSON stream uses `@ApiNdjsonStream(Line)` (`application/x-ndjson`, one schema per line, no SSE frames), an NDJSON file `@ApiFileResponse('application/x-ndjson')`. Never add a `discriminator`: `openapi-typescript` replaces the `event` literals with schema names. Every operation gets the `default` error response from `errorResponses`; a route that needs a different one spells its own

## Seed script

- `npm run seed:e2e` (`apps/api/src/seed/`) upserts by natural key and never touches an existing row: users `e2e_admin` (superuser) and `e2e_user`, language `PY3`, a problem type and group, public problems `e2e_sum` (one case, files in `PROBLEM_DATA_ROOT/e2e_sum/`) and `e2e_max` (two cases packed in `tests.zip`), contests `e2e_live` (running, ICPC) and `e2e_past` (ended), judge `e2e-judge` (key `e2e-judge-key` unless `FAKE_JUDGE_KEY`; used by `apps/bridge/test/fake-judge-cli.ts`), and `mail.smtpUrl` = `smtp://localhost:1025` (Mailpit) when it has no row
- Needs `MONGO_URL`, `PROBLEM_DATA_ROOT`, `ENCRYPTION_KEY`; passwords from `E2E_ADMIN_PASSWORD` / `E2E_USER_PASSWORD` (defaults in `main.ts`); refuses unless `NODE_ENV` is `test` or `development` (it writes known passwords); prints a JSON summary

## Problems

- Layout: `apps/api/src/modules/problems/` (`/api/internal/problems`), rendering in `libs/render`
- File names: reads are `problems.*`, write flows are `problem-<flow>.*` (`problem-editing`, `problem-uploads`)
- Rules live in `ProblemAccess` (`problem-access.ts`): `canSee`, `canEdit`, `visibleFilter`
- List filter `solved=true|false` (the viewer's solved problems, an AC with every case point; anonymous viewers have solved nothing); detail `contest` is `{ contestKey, attemptsLeft }` (null `attemptsLeft` = no `maxSubmissions`) when the viewer's current contest lists the problem, else null
- `visibleFilter` goes only inside `find`/`count`, never an aggregate
- Public routes: `@Public()` + `@CurrentAuth()` + `optionalPrincipal(auth)`; invisible or unknown problem -> 404, visible but not editable -> 403
- Events (`ProblemEvents`): `pointsChanged`, `publicityChanged`, `codeRenamed`, `statementChanged`; listeners run synchronously after the write
- Rate limits: `problems/core/rate-limits.ts`
- Languages admin (`/api/internal/admin/languages`, `catalog/languages-admin.*`): list, create and update only (`judge.add_language`, `judge.change_language`); `shortName` is the one field a PATCH may set to `null` (clears it); no delete and no key rename; every write resyncs the local `LanguagesQuerier`
- Problem catalogs admin (`/api/internal/admin/{problem-types,problem-groups,licenses}`, `catalog/*-admin.*` on `CatalogAdminService`): list, create and update only (`judge.add_*`, `judge.change_*` with `problemtype`, `problemgroup`, `license`); every write is a revision and resyncs the local querier
- Bulk visibility (`POST /problems/bulk/visibility`, `bulk/`): one `ProblemEditingService.applyEdit` per code, so a new PATCH rule applies to bulk without changes here
- Rendering styles: `problem`, `problem-full`, `solution` (editorials), `blog` (posts), `user` (raw HTML escaped; profile and organization `about`, comments); one `styleOf` picks the style per problem
- `blog` is `solution` made safe for strangers: author HTML is sanitized first, then KaTeX is spliced in through nonce slots, so author markup cannot forge math; author CSS is strict (no `position`, offsets, `transform`, `z-index`, `opacity`, negative margins, viewport units; units from an allow-list), classes need the `user-` prefix, iframes only from YouTube/Vimeo and sandboxed, no author MathML/SVG
- User-authored styles (`blog`, `user`) cut KaTeX down: `maxExpand` 50, `maxSize` 50, sizes beyond ±50em refused on the parse tree, macros with parameters refused (hex colours allowed only after colour commands), 20k parse-node cap, 500 ms of KaTeX per render in total (the first formula past it is a `math-error`, later ones show as source); `katex` stays pinned to exactly 0.19.0 because the limits use the internal `katex.__parse`
- Frontend requirement (load-bearing): every container of user-authored HTML (posts, comments, profile and organization `about`, ticket messages) needs `overflow: clip; contain: paint; isolation: isolate; min-width: 0; contain: inline-size`, and `.katex-display { overflow-x: auto }`; the sanitizer cannot stop in-flow overflow, containment does
- HTML is rendered and stored at save; reads never render
- `problem-full` HTML is unsanitized; writing statement text on a full-markup problem needs `judge.problem_full_markup`
- Markdown is capped at 200000 chars (`MAX_MARKDOWN_LENGTH`); render budgets per render: 2000 formulas of at most 1000 chars and 1.5 MB of KaTeX output (excess stays as source text), 200000 opening tags, nesting depth 500, 2 MB of HTML; past the tag, depth or HTML limit `renderMarkdown` throws `RenderLimitError` -> 400 `validation_failed` on the rendered field
- Math: `$..$` (no space inside the edges, so money is safe), `~..~` (spaces allowed), `$$..$$`; use `\vert` instead of `|` in table-cell math; math inside raw HTML blocks is not rendered
- Legacy `<blockquote class="spoiler">` works only at column 0 after a blank line
- Golden fixtures: `libs/render/src/fixtures/*.md|html`; regenerate with `UPDATE_GOLDENS=1 npx jest libs/render/src/goldens.spec.ts`, review the diff; listed in `.prettierignore`
- Uploads: type is sniffed from the bytes; SVG max 512 KiB, 20000 tags, nesting depth 1000; materials use an extension allow-list
- Text index: `await model.init()` in fixtures before `$text` queries

## Problem data

- `Problem.data` subdocument + `compileInitYaml` (`libs/problems`): sorted keys, `feedback` instead of `errors`, per-case `bridged` rejected, custom checker args composed from the uploaded source
- Volume: `PROBLEM_DATA_ROOT/<code>/` flat (`init.yml`, archive, sources); Polygon packages stage in `PROBLEM_DATA_ROOT/.imports/`
- Routes (`/api/internal/problems/:code/data`): `GET`/`PUT` (8 MiB body, 300 cases, 9999 with `judge.create_mass_testcases`), `GET init`, `POST archive` (.zip, 512 MiB; every entry is read, so a bad size or CRC-32 is refused at upload), `POST files/:kind` (`generator|customChecker|customGrader|customHeader`, 1 MiB), `DELETE files/:kind` (those plus `archive`), `GET files/:name` (attachment, `nosniff`)
- Source extensions: generator `cpp cc c pas java py`, customChecker `cpp pas java`, customGrader `cpp`, customHeader `h`
- Zip bounds (`ZIP_LIMITS`): 25000 entries, 2 GiB total, 512 MiB per entry, ratio 1100; no symlinks (folders too), control characters (raw CP437 bytes too), name parts over 255 bytes or names over 1024, a file and a folder of one name, a repeated folder record, a record whose local header or data runs past the central directory (folders checked like files), end records that disagree, or extra fields judge-v2's Rust `zip` reader would refuse or read differently (`zip-extra-fields.ts`)
- `isManuallyManaged` problem -> 404 on data routes except `GET files/:name`; mirror problem -> 403 on writes
- Rename: pre-check, then the `codeRenamed` listener moves the directory (and drops cached PDFs)
- A rename while an import of that problem is in flight fails that import (the worker's compare-and-set filters on `code`)
- Materials: `MEDIA_ROOT/materials/<problemId>/`
- PDF: `GET /:code/pdf` -> 200 file, 202 `rendering`, 503 `pdf_unavailable`; cache `PDF_CACHE_ROOT/<code>.<lang>.pdf`, dropped on `statementChanged` / `codeRenamed`; job id `pdf-<code>-<lang>`, `removeOnComplete: true`, `removeOnFail` kept 10 min (503 + `Retry-After` meanwhile)
- Soft delete: `DELETE /problems/:code {confirmCode}` (`judge.delete_problem` + edit rights; 409 `problem_in_contest`; 10 an hour per user), `POST /problems/:code/restore` (409 `not_deleted`, 409 `purged`), `GET /problems/deleted` (paged, `daysLeft`, only problems the viewer could see live), `POST /problems/:code/purge-now {confirmCode}` (superuser, 202); `deleted`, `meta` and `imports` are reserved problem codes (`@IsProblemCode()` on create, rename, clone and the Polygon import); delete and restore write a revision and queue `problem-solvers-recompute {problemId, reason}`; the daily `problem-purge` job (`upsertJobScheduler`, 03:30 in `site.timeZone`) purges problems deleted longer ago than `problem.deleteGraceDays` (30) to a tombstone and keeps every submission; a claim older than an hour is finished by the next sweep whatever the problem's age
- Reading problems: `ProblemsRepository` filters `deletedAt: null` in every finder; `findDeletedByCode`, `findIncludingDeleted`, `findSummariesIncludingDeleted`, `deletedPage`, `deletedIds` are the only finders that return deleted problems. Methods keyed by an id the caller already resolved (`update`, `releaseSolution`, `updateData`, `upsertTranslation`, `setDataBytes`, `caseCount`, `markDeleted`, `restore`) and the counters `countOtherReferences` and `sumDataBytes*` do not filter: resolve the problem through a filtering finder first. Any other direct reader of the `problems` collection must be classified F or S in `libs/database/src/problem-readers.spec.ts`, which fails on a new unclassified one, and every F reader must name the filter
- Package: `POST|GET /problems/:code/package` (editors; 202 building, 200 ready/zip attachment, 404 `package_not_built`, 409 `package_too_large`, 503 `package_unavailable`; 3 POSTs an hour per user and problem, 10 per user), cache `<PDF_CACHE_ROOT>/packages/<code>.<dataVersion>.<hash>.zip`, format in `apps/worker/src/jobs/problem-package/README.md`
- Submissions of a deleted or purged problem: listed and readable for their owner and `judge.view_all_submission` holders, problem shown as `{code, name, isDeleted: true}`, no case detail (also on the event stream: no `test-case` frames); everyone else 404; rejudge and reject answer 409 `problem_deleted`
- Publish after a contest: a deleted problem is `skipped` with reason `deleted`
- Polygon import (the rights of the change: create = `judge.add_problem` or the organization's creation rights, update = test data write access; syncing, auto-sync and link changes add `judge.sync_polygon_problem`): options in the query string; `POST /problems/imports` 202 `{ jobId }` (package <= 512 MiB, 10 per hour per user), `GET /problems/imports/:jobId` (requester or superuser; a failed job names its `failedStep`); job retained 24 h; every finished Polygon job (not zip imports) is a `polygonSyncRuns` row, listed by `GET /problems/:code/polygon/syncs` and, with `judge.edit_all_problem`, `GET /polygon/syncs`
- Import semantics: create defaults for catalog fields; update keeps catalog fields, points and authors unless given; every option comes from the job (no prompts); tests repacked as `tests.zip`; images re-hosted; a compile error fails the job before the DB write; the case limit is the requester's (300, or 9999 with `judge.create_mass_testcases`); the worker finds the package at `.imports/<jobId>.zip` and refuses a manually managed or mirror target
- Tags (`/api/internal/tags`, `catalog`, `:code`, `:code/assign`): tagging needs `allowTagging` plus `judge.add_tagproblem` or rating >= 1900; link presets (Codeforces, CodeforcesGym, Atcoder, VNOJ, Kattis); no external OJ calls

## Judging

- Collections: `submissions` (`cases` is `select: false`, at most 10000), `submissionSources` (`_id` = submission id, at most 65536 code points, counted by `codePointLength`), `judges` (`authKeyHash` = sha256 of the key; online fields written only by the bridge)
- Statuses QU P G D IE CE AB, and PD (final-submission contest rows: stored, not sent to a judge, requeued at priority 3 when the contest ends); results add AC WA TLE MLE OLE IR RTE SC RJ; priorities 0 contest, 1 normal, 2 rejudge, 3 batch rejudge, FIFO by id within one
- Queue truth is Mongo: queued = `status QU`; the bridge claims QU -> P before sending; every judge message's write filters `{ _id, judgedOn, judgeGeneration, judgeSeq: seq − 1, status }`
- API -> bridge: Redis stream `bridge:commands` (`judge`, `abort`, `disconnect-judge`, `disable-judge`), fire-and-forget via `BridgeCommandsService`; a lost `judge` command waits for the bridge's resync (`resyncMs`, 30 s), which also reconciles connected judges with Mongo (blocked, rotated key, `isDisabled`); `abort` is best-effort, the user aborts again
- Bridge -> effects: one `submission-graded` BullMQ job per finished (D/CE/IE/AB) or rejected submission, enqueued through `notifyGraded` (1 s bound, a failure is logged and skipped, in the bridge and the api)
- Bridge start: bind the port (judges wait), judges offline, stream position, queue rebuild, commands, resync, then serve judges; P/G rows are left to their judges' resume. Stop: dispatching stops first so P/G survive for the next start
- The resync requeues P/G runs no session and no grace held on two consecutive ticks, without spending `requeueCount`
- A lost session's runs wait 30 s (`resumeGraceMs`) for a resume; then requeued once (`requeueCount`), IE the second time; a rejudge restores the allowance; RETRY: requeued without spending it, IE at the third
- Link: metadata key check before any message; Hello first (15 s, ≤ 256 KiB); messages ≤ 4 MiB; ≤ 256 cases per message, 10000 per submission; 1000 messages/s; 60 s silence (paused while a message is handled); an `Assign` not accepted in 20 s is released; case text in UTF-8 bytes (clipped: 512 output/extended feedback, 50 feedback); 64 KiB logs (clipped); 256 sockets, 8 unauthenticated per remote address. A message for a run the session does not hold is ignored with one `Abort`; `Accepted` for one closes the session
- Dispatch: per slot, lowest busy share, random tie-break; a rejudge never takes the last free slot while there is more than one; languages decide capability (no problem lists); mirrors dispatch under `mirrorRoot`'s code and data version; `languageLimits` override limits; `short-circuit = !partial`
- Submit: visible problem, allowed non-file-only language, not banned (superuser exempt), `judgeId` (a judge name) for editors and only to an online judge that runs the language; 20 per minute per user; 2 unfinished (429 `rate_limited`) unless `judge.spam_submission`, counted under a fail-fast `withRedisLock` (`libs/common`; contention -> 409)
- File submit (`POST .../submit/file`, multipart `language`, optional `judgeId`, `file`): file-only languages only, through the same checks as submit; extension = `language.extension`, size ≤ `fileSizeLimit` MB (0 = off; clamped to `MAX_UPLOAD_BYTES`), a `SCRATCH` `.sb3` is reduced to its `project.json`; the file is saved at `submission_file/<code>/<userId>/<newId>.<ext>` under `MEDIA_ROOT` and its media URL is the source, which judges fetch with `FetchSource`
- `GET /api/internal/submissions/stats` (public, route declared before `/submissions/:id`): `{ judgedToday, acceptedToday, queueLength, judgesOnline, judgesTotal }`; counts only what a signed-out viewer may see (the list's own filter), "today" starts at midnight of the `site.timeZone` setting, cached 30 s in Redis (a zone change or the midnight rollover can lag that long), judges online = connected now, total = neither blocked nor disabled
- Detail/source: problem visible (else 404), then legacy `can_see_detail` (`F` follows `all-solved`); `totalCases` (the problem's case count, batch members included, null when the viewer may not see case results), cases by `testcaseResultVisibility` (A all, B batches, S none; superusers all), feedback for superusers/editors/`allowViewFeedback`, output unless `testcaseVisibility` O (editors always); IE messages for editors only; the list (`GET /api/internal/submissions`) is public over visible problems, and IE/QU/P/G/D/SC filters are staff-only (400)
- Actions: invisible problem -> 404; abort (owner unless rejudged, or `judge.abort_any_submission`), rejudge/reject (`judge.rejudge_submission`/`judge.reject_submission` + edit rights; 409 while unfinished; rejudge: while in flight or locked), bulk rejudge per problem (more than 10 needs `judge.rejudge_submission_lot`, locked only with `force`; counts first, then streams chunks of at most 1000 ids)
- Judges admin (`judge.change_judge`): `/api/internal/judges`; keys are shown once; rotate and block force-disconnect

## Judge protocol

- The contract is `libs/judge-proto/proto/qhhoj/judge/v1/judge.proto`, a copy of judge-v2 `proto/` at the tag named in `libs/judge-proto/proto.lock.json`. Never edit the copy or `libs/judge-proto/src/generated`: change judge-v2, tag it (`proto-v1.<minor>`), then `npm run judge-proto:sync -- ../judge-v2 <tag>` and commit `libs/judge-proto`.
- `npm run judge-proto:check` (CI) checks the copy against the lock and regenerates the TypeScript; `npm run judge-proto:check -- ../judge-v2` also checks the lock against the judge-v2 tag.
- `scripts/judge/check-deploy-copies.sh [../judge-v2]` checks that `deploy/judge/*` equals judge-v2 `packaging/`; run it when either side changes. `scripts/judge/emit-init-fixtures.ts <out-dir>` writes the `init.yml` shapes judge-v2 tests against (see `scripts/README.md`).
- Backend-judge contract: `libs/problems/src/judge-contract/` writes init.yml files (the real `compileInitYaml`), crafted zips with the upload reader's verdicts, and `ZIP_LIMITS` into `fixtures/`; its spec fails when the committed fixtures differ. judge-v2 keeps a copy in `crates/problem/tests/fixtures/judge-contract` and checks that it reads each the same. After a change: `UPDATE_JUDGE_CONTRACT=1 npx jest libs/problems/src/judge-contract`, commit, then replace judge-v2's copy in a judge-v2 PR: `rm -rf ../judge-v2/crates/problem/tests/fixtures/judge-contract && cp -r libs/problems/src/judge-contract/fixtures ../judge-v2/crates/problem/tests/fixtures/judge-contract`.
- Import types and the service from `@libs/judge-proto`; oneof bodies are `{ $case, <name> }` unions, 64-bit fields are numbers. Golden fixtures (`proto/golden`) and conformance scenarios (`proto/conformance`) come with the copy.

## Local judge

- `npm run stack:up` starts the gRPC fake judge (`apps/bridge/test/fake-judge-cli.ts`, `STACK_JUDGE=fake`): AC unless the source holds `FAKE_JUDGE_SOURCE_WA`; `hold-ack`, `hold-begin`, `hold-end` files in `FULLSTACK_CONTROL_DIR` hold a stage (release `hold-ack` within 20 s or the bridge reassigns the run). `STACK_JUDGE=none` starts no judge.
- `npm run judge:v2:up` starts judge-v2 (`qhhoj-judge`, built from `../judge-v2` or `JUDGE_V2_BIN`) against a `STACK_JUDGE=none npm run stack:up` stack: the seeded judge `e2e-judge`, loopback without TLS, `PROBLEM_DATA_ROOT` read directly, and the J7 hold files in `FULLSTACK_CONTROL_DIR`. It needs isolate 2.x with `isolate.service` running. `npm run stack:down` stops it. The real-backend journeys (J1-J8) pass against it.

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
- SSE layout: `modules/events/` holds the generic `EventStreamHub` (one Redis subscriber, caps, drain/buffer limits, heartbeat, recheck, resubscribe, shutdown) and `sse.ts`; a channel implements `EventChannel` and registers itself with the hub: `submissions/streams/submission-streams.service.ts` (submissions and feed) and `contests/announcements/contest-streams.service.ts` (contest announcements) and `notifications/streams/user-streams.service.ts` (`GET /events/user`, the owner's notification nudges). A new channel = a service like those, a controller and a Redis channel name
- Stream limits (`events/stream-limits.ts`, per api process): 12 per user, 16 per IP, 5000 total, 900 public feed, 1500 contest, 100 contest event-feed, 2000 user (notification) streams (submission and ticket streams keep the other 500); a client is dropped when a write stays undrained or the backlog stays above 16 KiB for 2 s in total, or at once above 256 KiB; 15 s heartbeat; access (session, user, detail rules) re-checked every 60 s

## Contests

- Layout: `apps/api/src/modules/contests/` (`/api/internal/contests`), formats and ranking helpers in `libs/contests`, worker jobs `contest-rescore`, `contest-final-judge`, `contest-rating` and `contest-data`
- Collections: `contests` (problems embedded, `accessCodeHash` sha256, `bannedJudges` judge names), `contestParticipations` (`virtual`: 0 live, -1 spectate, n virtual; `isRegistered` until the first join; live and frozen results), `contestSubmissions` (`_id` = submission id, points scaled to the contest problem); `users.currentParticipation`
- Rules live in `ContestAccess` (`core/contest-access.ts`): `canSee`, `canEdit`, `visibleFilter`, scoreboard and `canSeeFullSubmissionList` checks; viewer facts come from `ContestViewerService`; invisible or unknown contest -> 404 (also a malformed key), state conflicts -> 409
- Current participation is checked on read (`CurrentContestService.current`): ended or invisible contest -> pointer cleared (compare-and-set). Its scope feeds `ProblemAccess.canSee/visibleFilter`: before the start every problem is hidden, after it the contest's problems are visible
- Formats: a `ContestFormat` (`parseConfig`, `score`, `firstSolveTime`) in `libs/contests/src/formats/<kebab-case-name>.ts` (`final-submission.ts` for `final_submission`), registered in `FORMATS` (`registry.ts`); names `default ioi ioi16 icpc vnoj ultimate final_submission`; scored through `scoreParticipation(rows, { name, config }, context)`; configs are camelCase, validated on every write (400 `formatConfig`); `labelStyle` (`numeric|alpha`) replaces legacy Lua label scripts
- Freeze (`icpc`, `vnoj` only): absolute, contest end - `frozenLastMinutes`, and it stays after the end; an editor unfreezes by setting `frozenLastMinutes` to 0. Non-editors get only frozen fields and cells (`standingOf`, never mixed with live ones) in rankings and participations, own row included; editors always see live data
- Submit inside a current contest that lists the problem: priority 0, `lockedAfter` for live participations, pretests flag, `maxSubmissions` (IE and PD excluded) checked under the per-user lock; FSO submissions skip the unfinished limit; a running FSO contest stores `PD`: no bridge command, no event. The bridge reads banned judges, pretests and `in-contest` from Mongo at load and claim
- Effects: `SubmissionEffectsService.applyContest` rescales the contest submission (`contestSubmissionPoints`), `recomputeParticipation` (coalesced per participation) rewrites results and drops the four ranking keys
- Rescore: `contest-rescore {contestId}` (no `jobId`, one at a time) runs on `POST /:key/rescore`, disqualifications, problem rescores, and contest edits that change `scoringOf` (editing service): format, format config, `startTime`, `endTime`, `frozenLastMinutes`, `pointsPrecision`, or the problems' id, points, partial or order. Every edit purges the ranking keys; other edits do not rescore
- Ranking (`GET /:key/ranking`): one indexed read of the contest's rows, sorted in memory (`compareStandings`, competition ranks 1, 1, 3; ties in participation id order), cached per `{withVirtual, frozen}` for `scoreboardCacheTimeout` s with single-flight builds per api process; editors, own-row boards (viewer may not see the full board) and a 0 timeout bypass the cache
- Submission lists: `GET /:key/submissions` filters by contest and shows everyone's rows only when `canSeeFullSubmissionList` (never during a freeze unless editor), else the viewer's own (403 for another `user`). Other users' submissions of contests whose full list the viewer may not see leave `/api/internal/submissions` and the detail (403)
- FSO (`final_submission`): delayed job `final-judge-<contest>-<endTime ms>` rescheduled on create and edit, one-minute sweep over contests holding `PD` rows, `POST /:key/judge-final` (ended FSO contests only, else 409; ignores `autoJudge`); each run is serialised per contest, requeues each `PD` row once at priority 3 and skips rows rejected with `RJ`; a single rejudge of a `PD` row is 409; leaving `final_submission` while rows are `PD` is 409
- Access codes (`contests/core/rate-limits.ts`): wrong codes 10 per user and 30 per IP per 10 min on join and register (a missing code and a right one cost nothing); editors skip the code; virtual numbering retried up to 10 times
- Viewer fields: list rows carry `requiresAccessCode`, `disallowVirtual`, the registration window and `viewer {liveStatus, isCurrent}` (null signed out). `ContestViewerService.listViewersOf` reads them with one hinted participation query per page plus the current pointer. `liveStatusOf` (`libs/contests`) is `registered | participating | finished`. `isCurrent` uses `viewerOf`'s rule (an ended participation is not current). The detail viewer has the same two fields
- Detail problems: `viewerResult {cell, isSolved, attempts, hasPendingSubmission}` comes from the current scoring participation (else the live one). The cell comes through `standingOf`, so it is frozen for non-editors during a freeze, like the viewer's own ranking row. `attempts` counts what `maxSubmissions` counts (`UNCOUNTED_ATTEMPT_STATUSES`). `solverCount` is the ranking's `acceptedCount` over live rows, from one aggregate on `{contest, virtual}`, cached 30 s per frozen view (`solverCountsCacheKey`), purged by `purgeRankingCache`, and null unless `canSeeFullScoreboard`
- Refusals: `participation/participation-refusals.ts` is the one table of register, join and leave codes; add a case there, never a bare `AppError` in the service
- Disqualify (`POST /:key/participations/:id/disqualify`, `{ disqualified }`): scores -9999 (frozen fields too), bans or unbans the user from the contest, clears the current pointer, queues a rescore. The `contest.banAfterDisqualifications` setting (0 = off) bans the account (`isActive` false, `isUnlisted`) at that many disqualifications outside organisation-private contests; lifting uses compare-and-set on the ban reason
- Legacy `formatConfig` (imported contests) keys `last_score_altering` -> `lastScoreAltering`, `auto_judge` -> `autoJudge`, `LSO` -> `lso`; drop `cumtime` on `final_submission`; format name `Ultimate` -> `ultimate`; Lua label scripts become `labelStyle`
- Deviations from legacy: `ultimate` takes the latest row (no double count on equal dates), writes its tiebreaker and rounds its score; FSO final judging requeues `PD` rows only; no fifth ranking sort key (`-submission_count`); frozen results never reach non-editors

## Contest extras

- Action status: `GET /contests/:key/actions` (editors only) scans the live queue jobs for rescore, judge-final (manual only), rating, publish and replay builds, plus the automatic publish result (`autoPublish`); there is no failed state, since jobs are removed when they end
- Rating: `POST /contests/:key/rate` (`judge.contest_rating` + edit rights, ended contest, 409 while the board is frozen; the worker also skips a frozen target and leaves frozen contests out of the re-rate chain; a rescore of a contest with ratings is the follow-up trigger) queues `contest-rating` (global concurrency 1); the job deletes every rating from the earliest of the target's end, its stored ratings' end and any moved contest's end, re-rates every rated contest from there in end order, then refreshes `users.rating`; `libs/contests/src/rating/elo-mmr.ts` is the legacy Python ported line for line
- Elo-MMR goldens: `python3 -I tools/legacy/elo_mmr_goldens.py <online-judge>/judge/ratings.py libs/contests/src/rating/elo-mmr.goldens.json`; generated, never hand-edited
- Public ranking: links (`/contests/:key/ranking-link`, `/public-rankings/:token`, 18-char tokens, misses limited per IP) and the ranking code (`?code=`); both serve `ContestRankingService.board`, frozen while frozen
- Official ranking: CMS CSV parsed at write (`ranking/official-ranking.ts`: 1 MiB, 10 000 rows, 105 columns) or a URL
- Announcements: rendered at save; pushed as ids on Redis `contest-events` to `GET /api/internal/events/contests/:key` (the one SSE hub, `contestTotal` cap, shared with the other contest events); pushes limited per contest
- Stats: `GET /contests/:key/stats`, gated by `canSeeFullSubmissionList` (never during a freeze for non-editors)
- Similarity: see "Similarity" below
- Data: `CONTEST_DATA_ROOT` (unset -> 404); one prepare per contest per 24 h unless the zip is missing; zip written to a per-run temp name, streamed with lazily fetched sources, capped in bytes and entries; download streamed by the api
- Clone: `POST /contests/:key/clone` (`judge.clone_contest` + edit rights on the source), hidden, cloner as only author
- Contest tags: `GET /contest-tags` (public, paged, one page of up to 100 holds the catalogue), `POST /contest-tags`, `PATCH|DELETE /contest-tags/:slug` (`judge.change_contest_tag`; delete leaves contests with the slug, shown neutral); colours are theme token keys `tag-1`..`tag-8`; `409 tag_limit` past 100 tags; `contest.tags` stays an array of slugs and only slugs added to the stored set must be in the catalogue (`400 unknown_tag`, one issue per slug)
- Contest rules: `rules` (<= 8192, trimmed; blank = none), `rulesHtml`, `rulesRevision` (bumped when the trimmed text changes; compare-and-set, a concurrent save is 409) on the contest; `register` and `join` take `{acceptRules}`; a new row (registration, first live join, every virtual join) of a contest with rules needs `acceptRules: true` (`400 rules_not_accepted`), stored as `rulesAcceptedAt` and `rulesAcceptedRevision` on the participation (shown in the participations list); re-entering and spectating are exempt
- Problem limits: `ContestProblemResponse.timeLimit` (s) and `memoryLimit` (KiB), null when the viewer cannot see the problem (`ProblemAccess.canSee` with the contest scope while in the contest)
- Publish after the contest: `POST /contests/:key/publish-problems {editorials?, dryRun?}` -> per-problem `{outcome: published|unchanged|skipped, reason: no_permission|organization_private|not_found|deleted|null, editorial}`; `409 contest_not_ended`; 5 completed real runs per hour per user (dry runs free); verdict `publishVerdict` (edit rights + `judge.change_public_visibility`) in `libs/problems`; `publishAfterEnd` (+ `publishAfterEndBy`, `autoPublishOutcome`) and the `contest-publish` worker job (delayed at the end, `upsertJobScheduler` minute sweep over the partial index `publish_after_end_due`, re-checks the recorded editor's account, rights and contest edit rights; failure reasons `actor_unavailable`, `no_permission`, `cannot_edit_contest`); a clone resets the switch; `GET /contests/:key/actions` gains `publish` and `autoPublish`
- New codenames reach existing groups and users only through the admin UI (group edit); the api sees changed group rows after `GroupsQuerier` resyncs (change stream, else the 10-minute cron).

## Similarity

Replaces MOSS. Code similarity per problem or contest with `@dodona/dolos-lib`.

- Where: api `apps/api/src/modules/similarity/` (`core/` access, rate limits, runs repository; `start/` `POST /api/internal/similarity/runs`; `runs/` list and detail; `pairs/` `GET /runs/:runId/pairs`, `GET /pairs/:pairId`); worker `apps/worker/src/jobs/similarity/` (`similarity-engine.ts` parent, `similarity-engine.script.ts` child, `similarity-languages.ts` families); queue contract `SIMILARITY_QUEUE` in `libs/judging/src/queues.ts`
- Access: `judge.moss_contest` and edit rights on the problem or contest; unknown, not-visible and visible-but-not-editable scopes are all 404, a missing permission is 403
- Start: one active run per scope (unique index on `similarityRuns.scopeKey`, partial on `active: true`), 10 starts per user per hour (given back on 409 or an enqueue failure); at the next start a run queued 3 hours or running 40 minutes (deadline plus 10) is abandoned (`releaseStale` in the runs repository); an abandoned run never overwrites results
- Comparison: per problem and language family; C and C++ are one family (C++ grammar); Pascal is compared as text (weaker against renamed identifiers); languages without a grammar are listed in `unsupported`; CE, IE, AB, RJ and unjudged submissions are excluded; sources over 64 KiB or empty are skipped; newest `similarity.maxSubmissions` per family; every submission against every other of another user, a user's own pair is never built or stored
- Limits: `similarity.minPercent`, `similarity.maxPairs` (per run, most similar first), `similarity.maxSubmissions` are snapshotted into the run; 50 fragments per pair (1-based inclusive line ranges per side); deadline 30 minutes
- Engine: a child process per group (the library is ESM-only with native addons) with a V8 heap cap of 2 GiB; the parent kills it on the deadline and on shutdown; a failing group is skipped and flagged `failed: true`
- Run lifecycle: a success replaces the scope's earlier runs and pairs in one transaction; a failed run keeps them; a stalled redelivery fails the run; a shutdown mid-run fails it (`internal_error`) and keeps earlier results
- Pairs: the list omits problems the viewer cannot see; the problem-only and language-only filters read through the `{run, similarity, _id}` index; pair sources follow the normal submission source rules (`SubmissionsService.viewable`) for each side, else 404
- Legacy: `judge_contestmoss` rows (the `contestMoss` collection) are not migrated and legacy MOSS results are gone with them (the Stanford URLs expired); rows already in the database are left there, unreachable

## Organizations and users

- Membership is `users.organizations` (ordered; the first is the displayed one); every write goes through `OrganizationMembersRepository` (compare-and-set on the array for joins and reorders); admins are members, cannot leave or be kicked
- Rules live in `OrganizationAccess` (`organizations/core/organization-access.ts`): `canAdminister` (admin or `judge.edit_all_organization`, also on join requests), `canList`/`listFilter` (unlisted ones enumerated only to members, admins and `edit_all_organization`); an unlisted organization's page, members and request form stay reachable by slug
- Join: open organizations only, at most 3 open ones per user; private ones take requests (one pending per user and organization, 5 per hour per user); approvals check membership and `slots` against a live count under `withRedisLock('organization-requests:<id>')`; decisions record `decidedBy`/`decidedAt`
- Create (`judge.add_organization`): unlisted until staff lists it, `shortName = slug[:20]`, creator always admin; at most 3 admin roles per user unless `judge.spam_organization`; new admins join the `Org Admin` group when it exists; `isUnlisted`, `slots`, `shortName` need `judge.edit_all_organization`
- PATCH bodies go through `RefuseNullFieldsPipe` with a per-DTO nullable allowlist: `null` on any other field is 400, never stored
- Org PP and `memberCount` are written only by the `organization-points` job, queued by membership changes and by `recomputeUser` when a member's PP changed; enqueues coalesce per organization through a Redis NX pending flag; a failed enqueue is logged and lost until the next change
- `about` (users and organizations) renders at save in the `user` style (raw HTML escaped); editing a profile `about` needs >= 5 solved, staff or superuser, and not muted (an organization `about` needs only `canAdminister`); a profile `about` is locked for non-superusers when the `contest.officialMode` setting is on (so are comments and blog writing, see Blog and comments); other profile settings stay editable while muted; `firstName` (<= 30) is blocked in official-contest mode
- Leaderboards (`/users`, `/contributors`, `/users/:username/rank`) count listed, active users (`LISTED_USERS`); ties share a rank and pages continue it; each row carries the user's `rating` (null when unrated) and first listed `organization` (whoever views); rely on the `{isUnlisted, isActive, <field>, _id}` indexes, which the query planner picks (no `.hint()`), so they must exist (see Env and deploy)
- `/users/:username/pp-breakdown` is its own paged route; the first `PP_ENTRIES` rows are cached 600 s per user (`user-pp:<userId>`), so a newly private problem can show for up to 600 s
- Heatmap: last 365 days per day in `?timezone=`, else the viewer's zone, else UTC (`$dateToString` with the zone; a zone Mongo rejects falls back to UTC), cached 10 minutes per user and zone
- Public search: `GET /api/internal/organizations?search=` is a trimmed substring over name, shortName and slug (escaped, at most 50 characters), ANDed with `listFilter`
- User page: `GET /api/internal/users/:username` has a `staff` block (`UserPageStaffResponse`) only for `judge.ban_user` holders, otherwise `null`
- Staff lists: `GET /api/internal/admin/users` (username prefix with the CI collation, `banned` filter via the partial `banReason` index, never e-mail; `judge.ban_user`), `GET /api/internal/admin/organization-requests` (the queue across organizations, one state at a time; `judge.edit_all_organization`), `GET /api/internal/admin/posts?state=hidden|scheduled` (`judge.edit_all_post`)
- Ban (`judge.ban_user`, never yourself or a superuser): compare-and-set on `banReason`, unlisted, inactive, every session destroyed; the reserved automatic cheating reason cannot be used; unban restores rank `user`, listed and active whatever the user had before (legacy)
- User data: `USER_DATA_ROOT` (unset -> 404, muted -> 404); 3 prepares per user per day, one per 24 h while a fresh zip exists (`canPrepare`); zip (profile whitelist, own submissions with sources and `info.json`) kept 7 days, removed by the hourly sweep
- Quota: charge a creation with `QuotaService.charged(chargedOrganization(principal, subject), request, work)` after validation (spend first, refund when `work` throws; `work` gets the spent charge, so work finished elsewhere can carry it: a Polygon import job refunds it in the worker with `QuotaLedger.refundOnce`). The primitives the worker shares (limits, enforce mode, give-back, storage meter) live in `QuotaLedger` (`libs/problems/src/quota`), and callers use them there, not through `QuotaService`. Storage has one meter: `QuotaLedger.usedStorageBytes(organizationId)` is the only reader of what an organization holds, and `QuotaLedger.assertStorage(organizationId, addedBytes)` checks a write (the caller passes only what it adds: its growth, or a moved problem's full size); the Redis key `quota:databytes-backfilled` gates `quota.enforce`; worker jobs `problem-databytes` (one-off backfill) and `organization-usage-audit` (nightly drift log); settings `quota.*`
- Quota and tag refusals: 403 `quota_exceeded` (issue `field` is the meter, `credits` or `storage`; `details {meter, limit, used, needed}`), 409 `conflict` with issue `tag_limit_reached` (100 problem tags per organization), 400 `validation_failed` with issue `unknown_tag` (no such tag in the organization; contest tags too) or `unexpected_tag` (bulk `tagId` on an action that takes none)
- Tests: `setupApiTest` exposes `organizations`, `organizationRequests`, `userDataRoot`; `setupWorkerTest` exposes `organizations`, `userDataRoot`

## Blog and comments

- Posts: `blogPosts` (`organization` null = personal), `blogVotes`; rules in `BlogAccess` (`blog/core/blog-access.ts`): `canSee` (published personal posts public; published organization posts to members; anything else to editors), `canEdit` (`judge.edit_all_post`; authors; organization posts: author + admin + `judge.edit_organization_post`), `canDelete` (+ `judge.delete_blogpost`); lists use its filters, never their own
- Writing: >= 10 solved or superuser and not muted (`canWritePersonalPost`), organization posts by their admins with `judge.edit_organization_post`; `globalPost` needs `judge.mark_global_post`, `sticky` `judge.pin_post`; `authorIds` `judge.edit_all_post`; rendered at save in the `blog` style; revisions `entity: 'blogPost'`; delete takes the post's votes, comments (and their votes) and lock in one transaction; creates and edits share 10 writes per hour per user (`blog-write:user:<id>`, moderators included)
- Comments: page `{type, id}` with `type` `problem | editorial | contest | blog | tagProblem` and the entity id; the API takes natural keys (`/comments/pages/:type/:key`). Every page check goes through `CommentPagesService.accessible`/`resolve`, which reuses `ProblemAccess` (with the current contest scope), `ProblemsService.editorialReadable` (never inside a contest), `ContestAccess.canSee` and `BlogAccess.canSee`; add a page type there and nowhere else
- Threads: `parentId`, `threadId` (root), `path` (ids joined by `/`, depth <= 100); roots newest first, 20 per page, replies in `path` order (all replies of the page's roots); hidden comments listed to `judge.change_comment` only (`hidden`, `hiddenBy`); deleted comments listed as placeholders; `number` per page from `commentPageCounters`; `GET /comments/:id/location` gives the listing page of a comment's thread; `collapsed` at score <= -5; a problem of the viewer's started contest shows no thread (`CommentsService.hidesThread`: empty page, 404 on detail, votes, revisions and edit, skipped in recent comments) unless `judge.override_comment_lock`
- Posting needs >= 5 solved or staff, not muted (`canInteract`), an unlocked page (`commentLocks`, `judge.override_comment_lock` passes; a problem of the viewer's started contest is locked too), a visible same-page parent younger than 365 days (`judge.change_comment` replies to older ones); 10 comments per 5 min per user; body <= 8192, `user` style (raw HTML escaped, `renderCommentBody`, also behind `POST /comments/preview`, 30/min); the listing's `postBlock` and posting's refusals share `postBlockOf`; edits are compare-and-set on `revisions` with a `revisions` row (`entity: 'comment'`); `DELETE /comments/:id` (author or `judge.change_comment`) soft-deletes into a placeholder; `POST /comments/:id/reports` (once per user, 10/h), queue `GET /comments/reports` and `POST /comments/:id/reports/settle` for `judge.change_comment`
- `judge.change_comment`: hide/unhide a subtree (`POST /comments/:id/hidden`; each hidden row records `hiddenBy` (the comment whose hide hid it) and unhiding a comment clears only the rows it hid, so comments hidden on their own stay hidden; unhiding under a hidden parent is 409), vote list, `PUT|DELETE /comments/pages/:type/:key/lock`; subtree writes use `subtreeFilter` (an `$or` of equality and a prefix regex, so the `path` index bounds it)
- Votes: `PUT .../vote {score: 1 | -1 | 0}` on posts and comments through `VotesService` (not own, `canInteract`, 60 per minute per user across both) and `VotesRepository.cast` (row and target `score` in one transaction; a vanished target is 404 and aborts); the route answers 404 for an invisible post or hidden comment before `cast`
- Contribution points: written only by the `contribution-points` job (coalesced per user, always recomputed and `$set`, never incremented), queued by votes, hide/unhide, post visibility/authors/deletion and a suggested problem's `publicityChanged`; good tickets count 10 each
- Official-contest mode (`contest.officialMode` setting on): non-superusers get 403 on comment pages, posting, editing and comment votes and on blog create/edit (also for moderation routes, before any write); blog reads and post votes stay; recent comments are empty
- Homepage `GET /home`: 10 recent comments (batched scan, <= 10 batches of 2 x limit, readable pages only, one contest scope per call; the anonymous slice is cached 60 s as `home:recent-comments`), 7 new public problems, top 5 by PP and by contribution, counts (`contests` = those an anonymous visitor can see); contests come from `GET /contests?phase=`
- SEO (`seo/`): `GET /seo/robots.txt`, `/seo/sitemap.xml`, `/seo/sitemaps/:kind/:page` (signed-out view, Redis 1 h, 10000 URLs a file) and `/seo/preview?path=` (head tags for preview bots); nginx maps `/robots.txt`, `/sitemap*.xml` and bot user agents to them
- Feeds `GET /feeds/:kind/:format` (`blog|comments|problems`, `rss|atom`): a signed-out viewer's view only, 25 items, cached 300 s (`feed:<kind>:<format>`); superagent buffers the feed content types, so tests call `.buffer(true)` to read `.text`
- Discord: `DiscordWebhooksService.notify(event, message)` (api) queues `discord-webhook` only when the `discord.webhooks` setting has a URL for the event or `default`; the worker reads the URL from that setting, never from job data or logs; payloads set `allowed_mentions` to none, a 4xx is not retried, redirects are refused; comments announce only pages a signed-out viewer can read, posts only once published and personal; organization and suggested problems on create
- User-data export includes the user's own comments (hidden ones too) and own or co-authored posts, streamed into the zip
- Tests: `setupApiTest` exposes `blogPosts`, `blogVotes`, `comments`, `commentVotes`, `commentLocks`; `setupWorkerTest` `blogPosts`, `comments`, `tagProblems`; fixtures in `apps/api/test/community-fixtures.ts`
- Site content (`modules/site/`, `public/` + `admin/`): staff routes under `api/internal/admin/site/{pages,config}` with `flatpages.add|change|delete_flatpage`, `judge.change_miscconfig` (legacy Django names); pages are Markdown rendered at save in the `blog` style (urls `[-\w/.~]` only) with `revisions` rows (`entity: 'flatpage'`); `GET pages/:id/revisions` is 20 per page, readable after a delete, 400 on a malformed id; `POST pages/render-preview` shares the `render-preview:user:<id>` budget; every config write resyncs its querier in this process and other processes follow the change stream (`BaseCatalogQuerier` applies deletes); misc config is public through `GET /site`: no secrets; last write wins
- Accepted residuals: the unhide-parent check is read-then-write (P9 race); hide/unhide is not atomic across the subtree and the vote scores; moderators share the blog write budget; `font-size` multipliers scale after the size check (containment covers it)

## Tickets and site content

- Tickets: `tickets` (messages embedded, at most 500, `messageCount` and `lastMessageAt` denormalized), `generalIssues` (`issueUrl`, http(s) only); `linkedItem {type: 'problem' | 'general', id}`. Who may read: `TicketAccess.canSee` (`judge.change_ticket`, creator, assignee, an editor of the linked problem via `ProblemAccess.canEdit`); the list uses `ProblemAccess.editableFilter`, which mirrors `canEdit` (a spec keeps them equal). Existing but unreadable ticket: 403; unknown or malformed id: 404
- Filing: `POST /problems/:code/tickets` (problem visible to the filer; assignees = contest authors when filed from a current contest that has the problem, else the problem's authors) and `POST /tickets/general`; muted users refused (no solved-problem minimum, official-contest mode does not apply); 5 tickets per 10 min and 30 messages per 10 min per user; bodies render in the `user` style at save
- `PATCH /tickets/:id` `{isOpen, isContributive, notes, assignees}`: open/close for anyone who may read, `isContributive` for `change_ticket` and never on one's own ticket, `notes` (visible to everyone who may read the ticket) editable by assignees and `change_ticket` holders, `assignees` (usernames) for staff; all permissions are checked before the single write (one `updateOne`: `$set` plus the timeline `$push`); a good-ticket change queues the creator's contribution points (10 per good ticket, counted by the worker)
- Events: `TicketEventsService.publish` on `ticket-events` (`new-ticket`, `ticket-message`, `ticket-status`; ids only); `GET /events/tickets` and `GET /events/tickets/:id` are an `EventChannel` that judges every event per stream with `TicketAccess.canSee` and the stream's principal (refreshed by the hub's recheck)
- Timeline: `events[]` on the ticket (closed, reopened, assigned, unassigned, marked-good, unmarked-good; actor, time, target), written in the same `updateOne` as the state change (a compare-and-set on the changed fields; a concurrent change answers 409 `conflict`), `$push` with `$slice: -200` (a full timeline never refuses a change); the detail response keeps `messages` and adds `timeline` (messages and events by time, a message first at the same instant); list rows carry neither.
- Canned replies: `ticketCannedReplies` (title <= 60, body <= 8192, `order`), `/api/internal/ticket-canned-replies` for `change_ticket` holders, at most 100 (409), `{tên}`/`{bài}` filled in by the SPA, stored verbatim.
- Alerts: B1's `NotificationsService` through `TicketNotificationsService`; one inbox row per user per ticket (`groupKey ticket:<id>`); new ticket -> assignees (general: `change_ticket` holders, not superusers, at most 100), message -> owner (high when staff wrote) and assignees (when the owner writes on an unassigned ticket: the `change_ticket` holders, same filter as a new general ticket), close/reopen -> owner and assignees, assigned -> the new assignees, removed assignees' unread rows marked read (not the owner's); the actor is never alerted.
- `GET /tickets/summary` -> `{assignedOpen, awaitingStaff}` (cached 15 s per browser); `awaitingStaff` is staff-only and uses the stored `lastMessageByStaff` (a ticket without the flag counts as waiting). "Awaiting staff" means the last message was not written by a `change_ticket` holder: a reply by a non-staff assignee (a problem author) still counts as waiting.
- Discord: `on_new_ticket` and `on_new_ticket_message` through `DiscordWebhooksService` (legacy texts, `ticketMessageDescription`/`newTicketDescription`)
- Flatpages: `flatpages` with canonical urls (`/about`, no trailing slash; `normalizeFlatpageUrl`); `GET /pages/*` (public; `registrationRequired` and no session: 401); content is stored rendered. Misc config: `MiscConfigQuerier` (`BaseCatalogQuerier`, 10 minute resync) behind `GET /site` (`{config, officialMode, officialModeEndsAt}`, cached 60 s)
- User activity: the `onResponse` hook (`UserActivityCaptureService`, registered by `UserActivityModule`, not by `configureApp`) buffers rows (5000 max, flush at 200 rows or 2 s, one write at a time, a failed batch is dropped and logged by error name and code only) into `userActivity`, upserts `userSessions` (key = `sha256`, see `activitySessionKey`), feeds the live Redis sorted sets (`active:users|anonymous|bots`, 30 min) and writes `users.lastAccess`/`users.ip` at most once per 5 min per user (`user-access:<id>` `SET NX EX 300`). Query strings, cookies and raw session ids are never stored; credential-in-path routes (`/public-rankings/<token>`, `/reset-password/<token>`, `/activate/<key>`) are redacted in paths and referers: extend `CREDENTIAL_ROUTES` in `libs/community/src/user-activity.ts`, the one list; both collections expire after 90 days (TTL indexes). Untracked paths: `isTrackedPath`
- Staff API `api/internal/admin/user-activity` (`judge.can_see_user_activity`): `logs` (page + `hasMore`), `logs/export` (CSV, at most 100000 rows, formula-safe cells), `users/:username/logs|summary`, `DELETE users/:username|anonymous`, `live`
- Site content staff API: see the `Site content` bullet under Blog and comments (flatpages use the `blog` style); admin screens read `GET /site` with `cache: 'no-cache'`, because the route is `private, max-age=60` and a plain read would show pre-edit data for up to a minute
- Tests: `setupApiTest` exposes `tickets`, `ticketCannedReplies`, `generalIssues`, `flatpages`, `miscConfigs`, `userSessions`, `userActivities`; `setupWorkerTest` `tickets`; fixtures in `apps/api/test/ticket-fixtures.ts`; `streamsOf` counts ticket streams too

## Notifications

- Collections and indexes: `notifications`, one unread row per `user` + `groupKey` (partial unique index); lists order by `lastActivityAt, _id`; TTL on `expiresAt` = last activity + 90 days
- Writing: `NotificationsService.notify(recipients, draft)` in `libs/community/src/notifications/` never throws, merges into the unread row (`$inc count`, never lowers `high`), retries as a merge on E11000 (up to 3 attempts), cuts texts to 100/200 code points, refuses a `path` that is not an internal `^/(?!/)...` path, takes at most 200 recipients; `dismiss` marks a group read
- Producers in B1: contest announcements (the `notification-fanout` job) and a decided organization join request
- Realtime: `notification-events` carries `{ userId, id }`; `GET /events/user` sends `notification {id}`; contest announcements send no nudge; the bell polls `GET /notifications/unread-count` every 60 s and on focus
- Inbox API: `GET /notifications`, `GET /notifications/unread-count` (cached 15 s), `POST /notifications/:id/read`, `POST /notifications/read-all` (30/min); under impersonation both POSTs are 204 no-ops
- Jobs: `notification-fanout` (concurrency 2, idempotent through the row's `refs`, read rows included); `notification-trim` nightly at 03:30 through `upsertJobScheduler`, keeps the newest 500 per user, for every user over the cap, found by count
- Tests: `setupApiTest` exposes `notifications`, `setupWorkerTest` exposes `notifications` and `announcements`; `NotificationsService` is `app.get`-able

## Data conventions

- `tagGroups`/`tags` are querier-backed; `tagProblems` is a repository
- `Problem.data` and `dataVersion` are projected out of lists and reset on clone
- `_id` is a UUIDv7: declare `@IdProp() _id!: string`
- Helpers (`@libs/database`): `newId()` new id string, `uuidStr(value)` Binary -> hex string, `toUuid(id)` string -> BSON `UUID` for raw driver queries
- UUID arrays on hydrated docs (`user.groups`, ...): index access, spread and `toJSON()` give strings, but `.map/.filter/.flatMap/.slice` give raw buffers; map through `uuidStr` first
- `@Schema({ ...baseSchemaOptions, collection: '<name>' })`: timestamps, no `__v`, `toJSON` returns `id` instead of `_id`
- Case-insensitive unique fields: `ciIndex(Schema, 'field')` and query with `.collation(CI)` (see `libs/database/src/schema.db.spec.ts`); `ciIndex(schema, field, unique = true)`, e.g. `ciIndex(UserSchema, 'email', false)` for non-unique
- Catalog collections (languages, licenses, problem types and groups) are querier-backed and never deleted
- `submissions`, `submissionSources` and `judges` are repository-backed
- Register every schema in `SCHEMAS` (`libs/database/src/schemas/index.ts`) and export it there

## Naming and style

- Meaningful names; no single-character identifiers (variables, params, lambda args, catch vars); lint `id-length` min 2
- Prefer full words over abbreviations (`replSet`, `testingModule`)
- YAGNI, DRY, KISS; one-liners when equally readable
- Same shape for every instance of a pattern (every response maps with a `static from(entity)` on its `*.response.ts` class, as `UserSummaryResponse.from`)
- Formatting is Prettier through ESLint: `npx eslint --fix <files>`

### Glossary

Domain words (what a Judging, a Participation or an Effect is) are in [GLOSSARY.md](GLOSSARY.md); this table holds code identifiers only. One name per concept. Rename only where a term is ambiguous, and never rename a wire field (DTOs, packets, job data, schema fields).

| Concept                                      | Use                                                                                                                                                                                                                        | Not                                                                                        |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| A problem's public identifier                | `code` on the Problem schema, in problem routes (`:code`) and inside `modules/problems`; `problemCode` anywhere another code is in scope (bridge, judge requests, submissions filters)                                     | bare `code` next to an access code, error code or language key                             |
| A contest's public identifier                | `key`                                                                                                                                                                                                                      | `code`                                                                                     |
| Access codes                                 | `accessCode` (plaintext from the request), `accessCodeHash` (stored)                                                                                                                                                       | `code`                                                                                     |
| Database ids                                 | `<entity>Id` (`userId`, `problemId`, `contestId`, `submissionId`); `_id` only on documents                                                                                                                                 | `id` for a second entity in the same scope                                                 |
| A user in a role                             | `<role>Id`: `ownerId`, `authorId`, `requesterId`; schema fields keep their names (`user`, `suggester`, `authors`)                                                                                                          | `user` for an id                                                                           |
| The acting user                              | `principal: Principal` (identity and permissions); what services take                                                                                                                                                      | `auth`, `me`, `user` for the actor                                                         |
| The authenticated request                    | `auth: AuthContext` (`user`, `principal`, `session`, `sessionId`, `viaToken`); only where the session matters (cookies, CSRF, two-factor, impersonation)                                                                   | passing `auth` just to read `auth.principal` in new code                                   |
| The one a page is computed for               | `viewer`: `ContestViewer` (their participation), `viewerStatus` (solved/attempted), `viewerScope` (their current contest)                                                                                                  | `viewer` in a permission check (use `principal`)                                           |
| Another user's public data                   | `profile`                                                                                                                                                                                                                  | `user` for the same shape                                                                  |
| Problem test data                            | `data` (`ProblemData`: cases, checker, grader, archive)                                                                                                                                                                    | `data` for anything else                                                                   |
| Other payloads                               | `payload` (wire), `fields` (a DB patch), `dto` (a request body), `changes` (a diff)                                                                                                                                        | `data`, `info`, `result`                                                                   |
| Partial scoring                              | `partial`: a problem or contest problem scores per case                                                                                                                                                                    | "partial" for anything else                                                                |
| A session still owing its second factor      | "before two-factor": `AllowBeforeTwoFactor`, `twoFaPassed: false`                                                                                                                                                          | "partial auth"                                                                             |
| Durations                                    | a `Ms` or `Seconds` suffix on every number; a library option key (`delay`, `age`) takes a suffixed constant                                                                                                                | bare `timeout`, `delay`, `ttl`                                                             |
| Problem limits                               | `timeLimit` in seconds, `memoryLimit` in KiB (schema and wire names)                                                                                                                                                       | other units without a suffix                                                               |
| Booleans                                     | `isX`, `hasX`, `canX`, `shouldX`, `wasX`; a read that loads more takes `{ withX: true }`                                                                                                                                   | adjective-only names (`hidden`, `frozen`), literal `true`/`false` as a positional argument |
| Pretests                                     | `isPretested` (problem, contest problem, submission); `isPretest` (test case and contest-submission schema fields, init.yml `is_pretest`: kept DB names); `runPretestsOnly` (contest flag); `pretestsOnly` (judge request) | `pretested` outside the judge packet                                                       |
| The viewer's live participation in words     | `liveStatus` (`registered`, `participating`, `finished`)                                                                                                                                                                   | `state`, `status` alone                                                                    |
| The viewer's own result on a contest problem | `viewerResult` (`cell`, `isSolved`, `attempts`, `hasPendingSubmission`)                                                                                                                                                    | `viewerStatus` (that is the problem list's solved/attempted mark)                          |
| Submissions counted against `maxSubmissions` | `attempts` (IE and PD excluded)                                                                                                                                                                                            | `tries` (a format's cell field)                                                            |

## Readability rules

- One job per function: if its doc comment needs "and" to say what it does, split it into named helpers.
- Length: aim for 40 lines or fewer; 80 is the hard limit (lint `error`, blank lines and comments not counted; specs exempt).
- Complexity: aim for 10 or less; 15 is the hard limit (lint `error`). Essential complexity — a protocol switch, a tokenizer — gets an inline `eslint-disable-next-line complexity -- <why>` instead of a split that reads worse.
- At most 4 parameters (lint `error`; Nest DI constructors and decorated handler parameters exempt): group the rest in an options object with named keys.
- Units in names: every duration ends in `Ms` or `Seconds`, every size in `Bytes` or `Kib`.
- Booleans read as questions: `isX`, `hasX`, `canX`, `shouldX`, `wasX`; never pass a literal `true`/`false` positionally — use `{ withCases: true }`. A `setX(…, value)` setter is the one exception.
- Guard clauses first: refuse or return early, then the main path at one indentation level.
- Comments say why (a legacy rule, a race, a bound), never what the next line does.
- Options objects: destructure in the signature when every key is used; take the object whole when it is passed on.

## Testing

- The CI `db` job runs the specs that need MongoDB or Redis (mongodb-memory-server plus a Redis container); they also run locally. The file name says which kind a spec is:

  | File                                           | Needs                                                   | Config                           | Runs                             |
  | ---------------------------------------------- | ------------------------------------------------------- | -------------------------------- | -------------------------------- |
  | `<file>.spec.ts`                               | nothing: pure logic, static module metadata, temp files | `jest.config.js`                 | `npm run test:unit`, CI          |
  | `apps/api/test/openapi/*.openapi-spec.ts`      | nothing: document from stubbed controllers              | `test/jest/openapi.config.js`    | `npm run test:openapi`, CI       |
  | `<file>.db.spec.ts`                            | MongoDB (`startMongo`) or Redis (`TEST_REDIS_URL`)      | `test/jest/db.config.js`         | `npm run test:db`, local         |
  | `*.e2e-spec.ts`                                | a booted app or module with its databases               | `test/jest/db.config.js`         | `npm run test:db`, local         |
  | `openapi.e2e-spec.ts`, `*.openapi-e2e-spec.ts` | the booted api                                          | `test/jest/openapi-db.config.js` | `npm run test:openapi:db`, local |

- Unit specs must not connect: `jest.config.js` maps `ioredis` and `mongodb-memory-server` to stubs (`test/no-services/`) that throw on `new Redis()` or a server start, so a spec in the wrong place fails at once. Rename it `.db.spec.ts`; better, move the pure part (a filter builder, an ordering, a rule) into a function and test that in a unit spec
- `npm test` runs all four (`test:unit`, `test:openapi`, `test:db`, `test:openapi:db`); run `npm run test:db` before a PR that touches a repository, schema, queue or module wiring
- Unit: `<file>.spec.ts` next to the file under test; e2e: `apps/<app>/test/*.e2e-spec.ts` for apps, next to the file for libs
- Mongo: `startMongo()` from `@libs/database/testing`: databases of the caller's own on the run's one in-memory replica set (`test/jest/global-setup.js`), dropped by `stop()`; without the global setup it starts a replica set of its own
- HTTP: `createTestApp(moduleMetadata)` from `@libs/common/testing` (same pipes/filters/interceptor as prod)
- `npm run test:db` needs Redis (`TEST_REDIS_URL`, default db 15, which tests flush): `podman compose up -d redis` (or `docker compose`)
- Each jest worker flushes its own Redis db: `TEST_REDIS_URL`'s db plus `JEST_WORKER_ID - 1` (`redisUrlForWorker`, `@libs/common/testing`). A base db plus `--maxWorkers` must fit the server's `databases` (16 by default, 64 on the lane Redis)
- Bridge e2e: `setupBridgeTest` (`apps/bridge/test/setup.ts`, millisecond `FAST_TIMINGS`, `restart()`), `FakeJudge` (real TCP), `RecordingJudge` (no socket); api specs read the command stream through `apps/api/test/submission-fixtures.ts`
- Index use is asserted with `profileQueries` (`@libs/database/testing`): no `COLLSCAN`, documents examined bounded; worker effects fixtures in `apps/worker/test/effects-fixtures.ts`; SSE through `apps/api/test/sse-client.ts` (supertest cannot read streams); `recordSubmissionEvents` (`@libs/judging/testing`)
- Worker: `setupWorkerTest` (`apps/worker/test/setup.ts`); zip fixtures via `buildZip` from `@libs/problems/testing`; `TEST_ENV` lives in `@libs/common/testing`
- Playwright specs skip without Chromium (CI installs none); the pandoc spec skips locally and fails in CI without pandoc
- Similarity specs spawn the real engine (about 1 s each); they need the grammars compiled by `npm ci`
- `test/fixtures/django.json` is a frozen generated fixture, never hand-edited.
- `libs/<lib>/src/testing.ts` is the lib's only test-support entry (`@libs/<lib>/testing`), imported by specs and `apps/*/test` only; lint refuses it in production code. Keep it one file per lib; when it outgrows one screen, add a sibling file under `libs/<lib>/src/testing/` and re-export it from `testing.ts`, so the import path never changes.

## Commands

| Command                   | Purpose                                                                       |
| ------------------------- | ----------------------------------------------------------------------------- |
| `npm test`                | every spec: unit, OpenAPI, then the DB-backed ones (needs Redis)              |
| `npm run test:unit`       | unit specs only, no services (CI job `test`)                                  |
| `npm run test:db`         | `*.db.spec.ts` and `*.e2e-spec.ts`, in band (needs Redis; CI job `db`)        |
| `npm run format`          | Prettier write on `apps/` and `libs/`                                         |
| `npm run lint`            | ESLint (+ Prettier) on `apps/` and `libs/`                                    |
| `npm run test:openapi`    | the static OpenAPI specs with the swagger plugin (see OpenAPI)                |
| `npm run test:openapi:db` | the OpenAPI specs that boot the api (needs Redis; local only)                 |
| `npm run seed:e2e`        | idempotent dev/e2e seed (see Seed script)                                     |
| `npm run typecheck`       | `tsc --noEmit`                                                                |
| `npm run build`           | build `api`                                                                   |
| `npx nest build worker`   | build worker                                                                  |
| `npx nest build bridge`   | build bridge                                                                  |
| `npx nest start api`      | run the API                                                                   |
| `npx nest start bridge`   | run the bridge                                                                |
| `npx nest start worker`   | run the worker (from the repo root: KaTeX's CSS resolves from `node_modules`) |

CI (`.github/workflows/ci.yml`): lint, typecheck, test, all four builds.

## Env and deploy

- Production install, nginx, podman quadlets, env template, rollback: `deploy/RUNBOOK.md`
- `PROBLEM_DATA_ROOT`, `PDF_CACHE_ROOT` are required by the api, the worker and the bridge (all validate env)
- The api and the worker share `MEDIA_ROOT`, `PROBLEM_DATA_ROOT`, `PDF_CACHE_ROOT`
- `PROBLEM_DATA_ROOT` and `PDF_CACHE_ROOT` must not be under `MEDIA_ROOT` (served publicly); boot checks only `CONTEST_DATA_ROOT` against it, the others are the operator's to keep apart
- `CONTEST_DATA_ROOT` is shared by the api and the worker and must not be under `MEDIA_ROOT`
- `USER_DATA_ROOT` is shared by the api and the worker; boot rejects it under `MEDIA_ROOT` or overlapping `CONTEST_DATA_ROOT`
- The `contest.officialMode` setting (on) locks profile `about` and `firstName`, comment pages, posting, comment votes and blog writing for non-superusers
- Moved to admin settings (see Runtime settings; `GET /api/internal/admin/settings`, `PATCH .../<key>`, needs `judge.change_settings`): `site.timeZone` (new), `mail.smtpUrl`, `mail.from`, `auth.google`, `auth.facebook`, `auth.github` (social login), `auth.pwnedApiUrl`, `discord.webhooks`, `pdf.renderTimeoutMs`, `pdf.maxBytes`, `contest.officialMode`, `contest.banAfterDisqualifications`. Boot logs one warning (`Ignoring X, Y: these are admin settings now ...`) naming any of their old variables still set (`REMOVED_ENV` in `libs/common/src/env/removed-env.ts`) and ignores them (no env fallback); the values are never logged
- Mail locally: `docker compose up -d mailpit`, then either `npm run seed:e2e` (sets `mail.smtpUrl` to `smtp://localhost:1025` when no row exists) or, as a user with `judge.change_settings`, `PATCH /api/internal/admin/settings/mail.smtpUrl` with `{"value":"smtp://localhost:1025"}`; until `mail.smtpUrl` is set, registration answers 503 `mail_unavailable`; password reset and activation resend answer 204 and the mail is lost (logged)
- `discord.webhooks` (api and worker): a map of `default` or `on_<event>` keys (`on_new_comment`, `on_new_blogpost`, `on_new_problem`, `on_new_suggested_problem`, `on_new_ticket`, `on_new_ticket_message`) to https URLs (http only for `localhost`/`127.0.0.1` outside production, see Runtime settings); empty sends nothing; the worker needs outbound HTTPS to Discord
- nginx: serve `/media/submission_file/` with `Content-Disposition: attachment`, `Content-Security-Policy: sandbox` and `X-Content-Type-Options: nosniff` (file submissions are user bytes stored under their language's extension, which may be `html`, `svg` or `xml`; `nosniff` alone does not stop those).
- nginx: map the legacy `/feed/<blog|comment|problems>/<rss|atom>/` to `/api/internal/feeds/<blog|comments|problems>/<rss|atom>`
- The `.hint()` queries (organization members, submissions, comment threads) throw until their indexes exist: build them before serving (mongoose `autoIndex`); the leaderboards are not hinted but are only fast with theirs
- Worker memory limit: about 2 GB x job concurrency (Chromium, pandoc), plus up to 2 GiB for the similarity engine child (V8 heap cap, not a hard cap; native parser memory comes on top)
- The worker runs one similarity job at a time (queue concurrency 1)
- Worker image and CI need `python3`, `make` and `g++` at `npm ci`: the tree-sitter grammars of `@dodona/dolos-parsers` are compiled by node-gyp (never `--ignore-scripts`); the child resolves `@dodona/dolos-lib` itself, so the worker does not depend on its working directory
- Bridge: `JUDGE_BRIDGE_HOST` (default `127.0.0.1`), `JUDGE_BRIDGE_PORT` (default 9999), `JUDGE_BRIDGE_TLS_CERT`/`_KEY` (required off loopback); exactly one instance
- The bridge port must be reachable only from judge hosts (firewall)
- Streams: nginx must not buffer `/api/internal/events/` (`proxy_buffering off`; the api also sends `X-Accel-Buffering: no`) and needs `proxy_read_timeout` well above the 15 s heartbeat
- Worker tuning: `pdf.renderTimeoutMs` and `pdf.maxBytes` (settings), `PDF_CONCURRENCY` (env); the Polygon import queue runs one job at a time

## Releasing

The app follows Semantic Versioning (`package.json` `version`, starting at 2.0.0): major = breaking API, protocol or DB migration; minor = feature; patch = fix.

- Every PR adds a changeset: `npm run changeset` (pick the bump, write one line for the changelog) and commit the `.changeset/*.md` file; a pure CI/docs PR commits an empty one (`npx changeset --empty`). CI runs `npx changeset status --since=origin/main` on pull requests.
- Releases are automated (`.github/workflows/release.yml`): every push to `main` opens or updates the "chore: version packages" PR, which bumps `package.json` and `package-lock.json`, writes `CHANGELOG.md` and consumes the changesets. Review and merge it; the next run tags `v<version>` (`npm run release:tag`, idempotent) and creates a GitHub Release from the changelog section. Nothing is published to npm.
- One-time repo setting: Settings -> Actions -> General -> "Allow GitHub Actions to create and approve pull requests". The workflow uses only the default `GITHUB_TOKEN`.
- First release: the pending changesets were folded into the 2.0.0 entry, so the first Version PR is for the first change after 2.0.0.

## Short links and the sync API

- Modules: `modules/short-links/` (redirect `/s/:code`, staff list and delete) and `modules/sync/` (`clients/` admin routes, `contests/` the sync routes).
- A route for external systems is `@ServiceOnly()` + `@RequireScope(...)` under `api/sync/v1`; the guard attaches `request.serviceClient` and never `request.auth`; a missing `@RequireScope` refuses every key.
- Read official mode only through `isOfficialModeActive` / `officialModeLocks` / `assertNotLockedByOfficialMode` (`libs/community/src/official-mode.ts`); a structural spec fails on any other reader of `contest.officialMode*`.
- `judge.manage_short_link` and `judge.manage_integration` are granted to staff groups in the admin UI; check one staff user after the groups resync.
- Taking over a client-managed contest: no route writes `managedBy` (only a clone resets it), so revoke the client (its key stops working at once), then edit the contest by hand in the editor; a revoked client leaves its contests behind. While the client is live, its next sync `PUT` overwrites hand edits of an unpublished contest.
- Keys are `qhi_` + 256 random bits, shown once; only the sha256 is stored. Queries on `Contest.managedBy` must include `$type: 'binData'`.

## Commits

- One-line conventional subject: `feat: ...`, `fix: ...`, `docs: ...`, `refactor: ...`, `test: ...`, `chore: ...`
