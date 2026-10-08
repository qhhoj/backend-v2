# Contributing

Why things are the way they are: [docs/decisions.md](docs/decisions.md).

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
- Worker image: official static `pandoc` >= 3 (not the Debian/Ubuntu package: it fails with "failed to create OS thread" under the cap), util-linux `prlimit` (pandoc runs under `prlimit --as=768MiB`; without it conversion fails closed), Chromium
- `@dodona/dolos-lib` 3.5.1 (code similarity; ESM-only, so the worker runs it in a child process; V8 heap cap 2 GiB, native parser memory is bounded by the container; `npm ci` compiles its tree-sitter grammars with node-gyp, so the worker image and CI need `python3`, `make`, `g++`)
- Local services: `docker-compose.yml` (`mongo`, `redis`, `mariadb`, `mailpit`); env vars in `.env.example`

## Layout

```
apps/
  api/        HTTP app (Fastify): AppModule, main.ts, health.controller.ts, modules/ (feature modules incl. `mail/` (SMTP mailer) and `settings/` (admin API)), seed/ (`npm run seed:e2e`)
  migrator/   CLI (nest-commander): MariaDB -> MongoDB backfill/verify
  worker/     BullMQ jobs: jobs/<job>/<job>.module|processor|service|repository.ts (pdf-render, polygon-import, submission-effects, effects-sweep, problem-rescore, contest-rescore, contest-final-judge, contest-rating, similarity, contest-data, organization-points, user-data, contribution-points, discord-webhook)
  bridge/     judge TCP server (DMOJ protocol): protocol/, dispatch/, judges/, submissions/, bridge.service.ts
libs/
  common/     http layer (AppError and its subclasses, filter, interceptor, pipes), bootstrap, env, BaseMongoStreamQuerier, `runCoalesced`, AES-GCM helper (`crypto/`), time zones (`text/time-zone.ts`), OpenAPI helpers (`openapi/`), mail contract (`Mailer`, `MAILER`, `InMemoryMailer`)
  database/   uuid helpers, schema helpers, SCHEMAS, DatabaseModule
  settings/   runtime settings: `registry`, `setting-types`, `sealing`, `settings.querier`, `settings.service`, `settings.module`, `testing` (`fakeSettings`)
  auth/       groups, password, token, session, principal, users, guards, decorators, legacy Fernet `crypto` (no AES), AuthModule
  problems/   init.yml compiler, zip reader, problem data and PDF cache file services, statement helpers, queue contracts (`queues.ts`)
  judging/    scoring, points/PP formulas (`points.ts`), queue contracts (`queues.ts`: submission-graded, problem-rescore, effects-sweep, similarity), bridge commands + `BridgeCommandsService`, submission events + `SubmissionEventsService`, `notifyGraded`/`notifyRescore`
  contests/   contest time windows, standings and ranking cache keys, queue contracts (`queues.ts`: contest-rescore, contest-final-judge, contest-rating, contest-data), Elo-MMR (`rating/elo-mmr.ts`), contest events, data paths, one module per format in `formats/` (registry in `formats/registry.ts`)
  community/  org PP, ranks, interaction gate, user-data paths, comment paths and pages, blog post rules, contribution formula, Discord payloads, tickets (limits, Discord texts), ticket-events contract, flatpage urls, user activity rules (session keys, user agent classifier, CSV cells), queue contracts (`queues.ts`: organization-points, user-data, contribution-points, discord-webhook)
  render/     Markdown -> HTML (markdown-it, KaTeX, sanitizer, `blog` style); pure functions, golden fixtures in src/fixtures
test/fixtures/  legacy MariaDB dump (legacy.sql, django.json)
tools/legacy/   regenerates the fixtures
```

- Layer order (no cycles): `database` <- `common` <- `settings` <- `auth` <- every other lib and app
- Aliases: `@libs/common`, `@libs/database`, `@libs/settings`, `@libs/auth`, `@libs/render`, `@libs/problems`, `@libs/judging`, `@libs/contests`, `@libs/community` (and `@libs/<name>/*`) -> `libs/<name>/src`
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
- Size: a module stays flat until about 15 files; past that, group by feature into subfolders (each with the pattern above and its own `dto/`), keeping the `<x>-api.module.ts` at the module root. Shared helpers (rate-limits, shared DTOs) live in `core/`

```
contests/
  contests-api.module.ts
  core/            contests.*, participations.repository, contest-viewer, current-contest, contest-access(.module), rate-limits, dto (params, detail, list, queued)
  participation/   join, register, virtual, disqualify
  ranking/         board, ranking links, official ranking
  rating/          rate endpoint, ratings.repository
  announcements/   announcements, contest-events (SSE pushes)
  stats/  data/  submissions/
  editing/         create/update, clone
problems/
  problems-api.module.ts
  core/            list/detail, repository, access, search, events, rescore, revisions, rate-limits, multipart, shared dto
  catalog/         languages, licenses, groups, types queriers
  editing/         create/edit, policy, statement (translations, editorial, preview), clone
  data/            test data (store, upload, lifecycle, write guard)
  imports/  pdf/  uploads/
submissions/
  submissions-api.module.ts
  core/            list/detail, repository, access, rate-limits
  create/  actions/  streams/
auth/
  auth-api.module.ts
  core/            login/session/password change, rate-limits
  registration/  password-reset/  impersonation/
  social/          flow + OAuth providers
  two-factor/      second factor, totp, webauthn
organizations/
  organizations-api.module.ts
  core/            access rules, repositories (organizations, members, requests), points refresh, rate-limits, dto
  editing/  membership/  requests/
users/
  users-api.module.ts
  core/            listed-users, rate-limits, shared dto (username param, time zone)
  pages/  leaderboards/  profile/  moderation/  data/
blog/
  blog-api.module.ts
  core/            BlogAccess (blog-access.ts), BlogAccessModule (posts repository + visibility, imported by comments), lists, detail, organization posts, dto
  editing/  votes/
comments/
  comments-api.module.ts
  core/            CommentPagesService (the one page-access decision), threads, counts, locks, recent comments, rate-limits, dto
  posting/  votes/  moderation/
settings/          flat: admin settings API (`GET`/`PATCH /api/internal/admin/settings`)
mail/              flat: `SmtpMailer` behind the `MAILER` token
contributions/     flat: vote ledger (votes.repository), vote gates and limit, contribution-points enqueuer
discord/           flat: Discord webhook enqueuer
similarity/        core/ start/ runs/ pairs/: code-similarity runs and pairs (`judge.moss_contest` + edit rights)
home/              flat: homepage data, RSS/Atom feeds
tickets/
  tickets-api.module.ts
  core/            TicketAccess (ticket-access.ts), tickets.service, ticket-gate.service (muted users), repository, context (access view, links), responses, rate-limits, dto
  posting/         file a ticket (problem, general), messages
  editing/         PATCH: open/close, good, notes, assignees
  streams/         TicketEventsService (publish), ticket streams (SSE)
site/
  site-api.module.ts
  public/          flatpages, navigation and misc config queriers, `GET /site`
  admin/           staff CRUD for flatpages, navigation and misc config
user-activity/
  user-activity.module.ts
  capture/         onResponse hook, buffer, writer, live visitors store
  staff/           logs, summary, CSV export, live, deletes (`judge.can_see_user_activity`)
api-v2/            legacy shapes, grouped like the features
  api-v2.module.ts
  core/            envelope, exception filter, query and filter helpers
  contests/  problems/  submissions/  organizations/  users/
```

- File names: `<feature>.<role>.ts`, role in `controller|service|querier|repository|store|events|guard|decorators|module|schema|dto|mapper|command|filter|interceptor|pipe|error|processor|handler|oauth-provider|spec`
- A class is named after its file: `<Name><Role>` in `<name>.<role>.ts` (`ContestEditFieldsService` in `contest-edit-fields.service.ts`), so a `*.service.ts` class always ends in `Service`
- One exported responsibility per file; subdocument classes and small helper types may live with their owner
- Scope: a file exporting a class is `<name>.<role>.ts` with role = class suffix (`IdMapRepository` -> `id-map.repository.ts`); function/type modules and entry points (`main.ts`, `index.ts`, `testing.ts`, `uuid.ts`, `schema.ts`, `crypto.ts`, `mapper.ts`, `bootstrap.ts`) use a plain noun
- Exception: `pipes/validation.pipe.ts` exports `validationPipe` (default instance) and `createValidationPipe(overrides)`, not a class
- Tests: unit specs `<file>.spec.ts` next to the file under test; app e2e specs in `apps/<app>/test/*.e2e-spec.ts`, library e2e specs next to their file (e.g. `libs/common/src/http-layer.e2e-spec.ts`)
- Schemas are shared: `libs/database/src/schemas/<entity>.schema.ts` (not per feature)
- Jobs: `@Processor(QUEUE[, { concurrency }]) extends WorkerHost` (`processor` = BullMQ consumer in `apps/worker`; env-driven concurrency is set in `onApplicationBootstrap`), one module per job; queue names and job data types live in `libs/problems/src/queues.ts` (problem jobs) and `libs/judging/src/queues.ts` (`submission-graded`, `problem-rescore`, `effects-sweep`, `similarity`) and `libs/contests/src/queues.ts` (`contest-rescore`, `contest-final-judge`, `contest-rating`, `contest-data`) and `libs/community/src/queues.ts` (`organization-points`, `user-data`, `contribution-points`, `discord-webhook`)
- `handler`: one instance per judge socket (`apps/bridge/src/judges/judge.handler.ts`)
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

- Env keeps infrastructure and key material: `MONGO_URL`, `REDIS_URL`, `ENCRYPTION_KEY`, `TOKEN_SECRET`, `SITE_URL`, `PORT`, `LOG_LEVEL`, `TRUST_PROXY`, `COOKIE_SECURE`, `MEDIA_ROOT`, `MEDIA_URL`, `PROBLEM_DATA_ROOT`, `PDF_CACHE_ROOT`, `CONTEST_DATA_ROOT`, `USER_DATA_ROOT`, `PDF_CONCURRENCY`, `JUDGE_BRIDGE_HOST`, `JUDGE_BRIDGE_PORT`, `LEGACY_MYSQL_URL`, `LEGACY_SECRET_KEY`, `TEST_MYSQL_URL`, `TEST_REDIS_URL`
- Settings (the admin edits them, no restart): `site.timeZone`, `contest.officialMode`, `contest.banAfterDisqualifications`, `discord.webhooks`, `mail.from`, `mail.smtpUrl`, `auth.pwnedApiUrl`, `auth.google`, `auth.github`, `auth.facebook`, `pdf.renderTimeoutMs`, `pdf.maxBytes`, `similarity.minPercent`, `similarity.maxPairs`, `similarity.maxSubmissions`
- Add one: a `define({ type, default, description, secret, combine? })` entry in `SETTINGS` (`libs/settings/src/registry.ts`), `type` from `setting-types.ts` (add a type there when none fits); no other file changes, the admin API and revisions pick it up. `secret: true` encrypts the whole value, `secret: ['clientSecret']` those top-level fields; `combine` merges a PATCH into the stored object (the `auth.*` clients), without it the patch replaces the value
- Read: inject `SettingsService` and call `settings.get('<key>')` where the value is used, never cache it (it is a synchronous read of an in-memory snapshot kept fresh by change stream plus a one-minute resync, so a change reaches api, worker and bridge within seconds); a consumer that builds something expensive keys it by the value (the mailer keeps its SMTP transport per URL)
- Write: only `SettingsService.set(key, patch, actorId)` (one transaction: combine, validate, seal, upsert, revision); over HTTP `GET /api/internal/admin/settings`, `PATCH /api/internal/admin/settings/:key` with `{ value }`, `GET .../:key/revisions`, all needing `judge.change_settings` (grant it to superusers only, it can point the server at outbound URLs). `null` is refused: clear with `{}` (webhooks), `''` (URLs, SMTP) or `enabled: false`
- A stored value that cannot be read (corrupt row, rotated `ENCRYPTION_KEY`) falls back to the default and the process keeps booting
- Secrets (`mail.smtpUrl`, `discord.webhooks`, each `clientSecret`) are returned by `GET` as `{ set: true }` only, stored sealed, redacted in revisions (`changedFields` names what changed); never log or echo a value, and a `SettingError` message never contains the input
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
- Nest `HttpException` < 500 maps to codes `unauthorized|forbidden|not_found|rate_limited|http_error`; anything else is `internal_error`
- Validation: DTO classes + class-validator; global pipe is whitelist + forbid unknown + transform, failure -> `validation_failed` (400) with `fields` (messages per field, unchanged) and `issues`
- `issues: [{ field, code, message }]` is the machine-readable twin of `fields`, built from one list by `ValidationFailedError` (or derived by `AppError` when `fields` is given, code `invalid`); codes are snake_case: the failing constraint name (`max_length`, `is_in`), or `context: { code: '...' }` on the class-validator decorator (`username_invalid_characters`, `email_invalid`), or the code a service gives (`invalidField(field, message, code)`, `ValidationFailedError`): `username_taken`, `email_taken`, `password_pwned`, `organization_unavailable`, `language_unknown`, `language_takes_file`, `language_takes_text`, `file_upload_disabled`, `language_extension_invalid`, `file_wrong_extension`, `scratch_project_invalid`, `must_not_be_null` (a PATCH field that may not be null), `password_incorrect`, `password_unchanged`, `assignee_unknown`, `invalid_url`, `invalid_path`, `invalid_regex`, `parent_unknown`, `parent_cycle`; nested DTO fields use dotted names (`appearance.glass`)
- `extra` (6th `AppError` argument) is merged into the error object next to `code` and `message`, never overriding them; `BannedError` (login) uses it for `banReason`
- Query DTOs: `@Type(() => Number)` for numbers; `dto/transforms.ts` (`toArray`, `toBoolean`) for arrays and booleans
- Repeated filters are sent as `typeIds=a&typeIds=b`, never `typeIds[]`
- Multipart routes read `request.parts({ limits: { files: 1, fields: 0, fileSize } })`, check for a single file and the expected fieldname, and never declare `@Body()`; an oversized file is `file_too_large` 413
- Multipart helpers: `problems/core/multipart.ts` (`readMultipartFile` buffers, `saveMultipartFile` streams to a path); per-call `limits` override the plugin default
- Raw file responses: `@RawResponse()` + `@Res({ passthrough: true })` (the PDF route uses plain `@Res()` to keep its 202)
- App wiring: `configureApp(app)` + `fastifyAdapter()` from `@libs/common` (used by `main.ts` and tests)

## Auth

- Every route is authenticated by default (global `AuthGuard`); opt out with `@Public()`
- Decorators: `@AllowBeforeTwoFactor()` (before 2FA), `@AllowPwnedPassword()`, `@SessionOnly()` (Bearer -> 403 `forbidden`; used on password change, token regenerate, logout-all, the 2FA enrol/disable/credential routes and impersonation start/stop), `@NoImpersonation()` (403 `forbidden` while impersonating; 2FA enrol/disable/credential routes, password change, token regenerate), `@RequirePermission('judge.<codename>')`, param `@CurrentAuth()` -> `AuthContext`
- Origin rule: unsafe methods without a Bearer header must carry no `Origin` or exactly the `SITE_URL` origin, else 403 `csrf_failed`; checked first, even on `@Public` routes. The session cookie is re-issued once a day while the session is active
- Guard order: Origin check -> authenticate (Bearer, else session cookie; an invalid Bearer token is rejected 401 even on `@Public` routes) -> cookie refresh -> `@Public` exit -> `unauthorized` -> `@SessionOnly` -> CSRF (`csrf_failed`) -> 2FA (`two_factor_required`) -> pwned password (`password_change_required`) -> `@NoImpersonation` (`forbidden`) -> permission (`forbidden`)
- Error codes: `unauthorized` 401, `invalid_credentials` 401 (login) / 400 (password change), `csrf_failed` 403, `two_factor_required` 403, `password_change_required` 403, `forbidden` 403, `banned` 403 (login; `banReason` is a member of the error object), `account_not_activated` 403, `rate_limited` 429, `validation_failed` 400, `conflict` 409, `not_found` 404, `not_impersonating` 400, `invalid_token` 400 (activation/reset/social token), `invalid_code` 400 (TOTP/scratch code), `totp_not_enabled` 400, `webauthn_not_enabled` 400, `webauthn_failed` 400, `banned_from_problem` 403, `contest_submission_limit` 403, `unfinished_submission_limit` 429, `solve_first` / `contest_running` / `hidden` 403 (submission detail and source: solve the problem first; the contest's list is not open yet; no access), `mail_unavailable` 503, `pdf_unavailable` 503 (statement PDF render failed; carries `Retry-After`; the SPA polls `GET /problems/:code/pdf` no faster than every 3 s and stops on 503)
- SPA contract: cookie `qhhoj_session`; send `X-CSRF-Token` (from `/auth/me` or login) on POST/PUT/PATCH/DELETE
- API tokens (Bearer) skip the CSRF, 2FA and pwned-password gates but cannot reach `@SessionOnly()` routes; the token stays valid across a password change (design choice)
- Login rate limiting is reserve-then-release, per IP plus per resolved account; unknown usernames are limited per NFKC-lowercased name
- Behind nginx set `TRUST_PROXY` to its address (e.g. the container network CIDR); otherwise every client shares one IP and the per-IP limits (login, streams) become global
- `@fastify/cookie` is pinned at 11.0.2: 11.1.1+ depends on ESM-only `cookie` 2, which breaks Jest CJS; do not bump
- New permissions: add the codename to `libs/auth/src/principal/permissions.ts`
- Account flows live in `apps/api/src/modules/auth/<flow>/<flow>.controller.ts` + `<flow>.service.ts` + `dto/` (registration, password-reset, social); totp and webauthn share `auth/two-factor/` (`totp.controller.ts`, `webauthn.controller.ts`, `second-factor.service.ts`) and `impersonation/` has no `dto/`; add new flows the same way and list their paths in `apps/api/test/openapi.e2e-spec.ts`
- Mail goes through the `MAILER` token (`@libs/common`; `SmtpMailer` in `apps/api/src/modules/mail/`): SMTP from the `mail.smtpUrl` setting, sender `mail.from`, both read per message (a new URL gets a new transport, the old one is closed); `InMemoryMailer` in tests; a send failure, or no `mail.smtpUrl` set, is `mail_unavailable` 503
- Uploads go through `StorageService` (`@libs/common`): files live under `MEDIA_ROOT` (a volume nginx serves at `MEDIA_URL`), paths are checked to stay inside it, and callers never pass client-supplied names unsanitised; file type is decided from the bytes (exception: a file submission keeps its language's extension, which `LANGUAGE_EXTENSION_PATTERN` limits to `[a-z0-9]{1,10}`, as legacy did)
- Deploy requirement for the nginx `/media` location: send `X-Content-Type-Options: nosniff`; `/media/materials/` uses `default_type application/octet-stream` and `Content-Disposition: attachment`; `/media/images/` and `/media/materials/` add `Content-Security-Policy: sandbox`
- Frontend routes embedded in mails/redirects (SPA contract): `/activate/<key>`, `/reset-password/<token>`, `/login`, `/login/2fa`, `/register/social?token=<token>`, `/`, `/post/<id>`, `/problem/<code>`, `/problem/<code>/editorial`, `/contest/<key>`, `/tagproblem/<code>`, `/ticket/<id>`, `/user/<username>`, `#comment-<id>` (Discord links and feeds)
- Registration: usernames `^\w+$` (max 30), email unique case-insensitively (checked in code); activation keys are stored as sha256 hashes; optional `organizationId` (an open, listed organization the account joins) and `languageId` (its default language), each refused with an issue code when unknown or unavailable
- `GET /auth/username-available?username=` -> `{ available }` (public, 30 per 10 min per IP; a stale pending signup reads as available); `POST /auth/activate/resend { email }` -> 204 whatever the email (resends only to a pending account, replaces its activation keys; 10 per hour per IP, 3 per hour per email); `GET /auth/social/providers` lists the enabled providers
- Session shape (`GET /auth/me`, login): `SessionResponse { user, csrfToken, twoFactorRequired, twoFactor, passwordChangeRequired, impersonatorId }`; `user` carries `siteTheme`, `appearance` (null until set) and `languageId`; before the second factor `user` is null and `twoFactor` is `{ username, methods }` (`totp`, `webauthn`; empty when the factor was disabled meanwhile: sign in again). `siteTheme` defaults to `auto` for new accounts and must match `^[a-z][a-z0-9-]{0,31}$` (the SPA owns the theme ids)
- 2FA enrolment (`totp/enroll`, `webauthn/register/options`) and removing a WebAuthn credential require `currentPassword` and share the `password-confirm` failure budget; WebAuthn registration and login use separate session challenges
- Password reset also works for active accounts with an unusable (`!`) hash (migrated social-only users): it sets their first password; the token is bound to the stored hash, so it is single-use either way
- Rate limits for guarded attempts use `RateLimitService.reserve(keys, limit, windowSeconds)`: it hits first, throws `rate_limited` over the limit, and returns a `release()` to call on success (only failures consume budget); all limit/window constants live in `auth/core/rate-limits.ts`. The password-reset per-email limit (3/hour) is never released, an accepted trade-off
- Second factor: TOTP and WebAuthn share one budget (10 failures/900 s, 50/day); completing it sets `lastLogin` and `twoFaPassed`. TOTP secret and scratch codes are encrypted at rest (`encrypt(..., encryptionKey(env.encryptionKey))`). WebAuthn does not require user verification
- `SessionData` goes through Redis cjson: no integers of 15+ digits (precision loss), no arrays, absent values are `null` (`undefined` is dropped); keep values to strings, booleans, `null` and small numbers
- Single-use session fields (`pendingTotpSecret`, `webauthnChallenge`) are read only via `SessionService.consume(id, field)`
- Social login (`GET /auth/social/{google|facebook|github}/start|callback`, `POST /auth/social/complete`): a provider is enabled by its `auth.google|facebook|github` setting (`enabled`, `clientId`, `clientSecret`) and disappears from `GET /providers` and 404s at start and callback the moment it is disabled; state is bound to the browser by the `oauth_state` cookie, and the signup continuation by the `oauth_pending` cookie (set by the callback, must equal the `complete` token, else 400 `invalid_token` without spending it); `start` is limited to 30 per IP per 600 s. Stored legacy provider names: `google-oauth2`, `facebook`, `github-secure`
- Impersonation (`POST /auth/impersonate/{userId}`, `/stop`): active superusers only, never onto a superuser or nested; `lastLogin` is untouched; the guard rechecks the impersonator on every request and ends the session if they lost superuser rights; credential routes are `@NoImpersonation()`
- Test overrides: `setupApiTest({ overrides: [{ provide, useValue }] })` (the harness already swaps `MAILER` for an `InMemoryMailer`); clear `rate:*` Redis keys in tests that need a fresh budget

## OpenAPI

- `GET /api/internal/openapi.json` (raw JSON, no auth) is the contract the frontend generates its types from; `docs/decisions.md` has why
- Response shapes are classes in `dto/*.response.ts`; the swagger CLI plugin (`nest-cli.json`) documents every `*.dto.ts` and `*.response.ts` from its types and comments, so a new route needs only its class, no decorators
- A paginated route returns `Paginated<Item>` and carries `@ApiPaginatedResponse(Item)` (`{ data: Item[], meta }`); `@RawResponse()` marks routes that bypass the `{ data }` envelope (legacy `/api/v2`, files); `envelopeResponses` wraps every other 2xx JSON schema in `{ data }`
- Give `Record`, `unknown`, nullable-union and integer-bounded fields an explicit `@ApiProperty(...)` (the plugin cannot infer them); multipart bodies use `@ApiConsumes` + `@ApiBody`
- `npm run test:openapi` runs `openapi.e2e-spec.ts` under `jest.openapi.config.js`, which applies the plugin; plain jest cannot (the plugin reads types, so `isolatedModules` must be off) and the main suite ignores that spec. It fails for a JSON route without a response schema, so run it after adding or changing a route

## Seed script

- `npm run seed:e2e` (`apps/api/src/seed/`) upserts by natural key and never touches an existing row: users `e2e_admin` (superuser) and `e2e_user`, language `PY3`, a problem type and group, public problem `e2e_sum` with one case (files in `PROBLEM_DATA_ROOT/e2e_sum/`), and `mail.smtpUrl` = `smtp://localhost:1025` (Mailpit) when it has no row
- Needs `MONGO_URL`, `PROBLEM_DATA_ROOT`, `ENCRYPTION_KEY`; passwords from `E2E_ADMIN_PASSWORD` / `E2E_USER_PASSWORD` (defaults in `main.ts`); refuses unless `NODE_ENV` is `test` or `development` (it writes known passwords); prints a JSON summary

## Problems

- Layout: `apps/api/src/modules/problems/` (`/api/internal/problems`), `modules/api-v2/` (`/api/v2`), rendering in `libs/render`
- File names: reads are `problems.*`, write flows are `problem-<flow>.*` (`problem-editing`, `problem-uploads`)
- Rules live in `ProblemAccess` (`problem-access.ts`): `canSee`, `canEdit`, `visibleFilter`
- List filter `solved=true|false` (the viewer's solved problems, an AC with every case point; anonymous viewers have solved nothing); detail `contest` is `{ contestKey, attemptsLeft }` (null `attemptsLeft` = no `maxSubmissions`) when the viewer's current contest lists the problem, else null
- `visibleFilter` goes only inside `find`/`count`, never an aggregate
- Public routes: `@Public()` + `@CurrentAuth()` + `optionalPrincipal(auth)`; invisible or unknown problem -> 404, visible but not editable -> 403
- Events (`ProblemEvents`): `pointsChanged`, `publicityChanged`, `codeRenamed`, `statementChanged`; listeners run synchronously after the write
- Rate limits: `problems/core/rate-limits.ts`
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
- File submit (`POST .../submit/file`, multipart `language`, optional `judgeId`, `file`): file-only languages only, through the same checks as submit; extension = `language.extension`, size ≤ `fileSizeLimit` MB (0 = off; clamped to `MAX_UPLOAD_BYTES`), a `SCRATCH` `.sb3` is reduced to its `project.json`; the file is saved at `submission_file/<code>/<userId>/<newId>.<ext>` under `MEDIA_ROOT` and its media URL is the source, which the bridge makes absolute with `SITE_URL`
- `GET /api/internal/submissions/stats` (public, route declared before `/submissions/:id`): `{ judgedToday, acceptedToday, queueLength, judgesOnline, judgesTotal }`; counts only what a signed-out viewer may see (the list's own filter), "today" starts at midnight of the `site.timeZone` setting, cached 30 s in Redis (a zone change or the midnight rollover can lag that long), judges online = connected now, total = neither blocked nor disabled
- Detail/source: problem visible (else 404), then legacy `can_see_detail` (`F` follows `all-solved`); `totalCases` (the problem's case count, batch members included, null when the viewer may not see case results), cases by `testcaseResultVisibility` (A all, B batches, S none; superusers all), feedback for superusers/editors/`allowViewFeedback`, output unless `testcaseVisibility` O (editors always); IE messages for editors only; the list (`GET /api/internal/submissions`) is public over visible problems, and IE/QU/P/G/D/SC filters are staff-only (400)
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
- SSE layout: `modules/events/` holds the generic `EventStreamHub` (one Redis subscriber, caps, drain/buffer limits, heartbeat, recheck, resubscribe, shutdown) and `sse.ts`; a channel implements `EventChannel` and registers itself with the hub: `submissions/streams/submission-streams.service.ts` (submissions and feed) and `contests/announcements/contest-streams.service.ts` (contest announcements). A new channel = a service like those, a controller and a Redis channel name
- Stream limits (`events/stream-limits.ts`, per api process): 8 per user, 16 per IP, 5000 total, 1000 feed, 2000 contest; a client is dropped when a write stays undrained or the backlog stays above 16 KiB for 2 s in total, or at once above 256 KiB; 15 s heartbeat; access (session, user, detail rules) re-checked every 60 s
- `/api/v2/submissions` (oldest first; totals only with `user` or `problem`) and `/api/v2/submission/:id` (login, `can_see_detail`; cases follow the problem's case visibility, stricter than legacy)

## Contests

- Layout: `apps/api/src/modules/contests/` (`/api/internal/contests`), formats and ranking helpers in `libs/contests`, worker jobs `contest-rescore`, `contest-final-judge`, `contest-rating` and `contest-data`
- Collections: `contests` (problems embedded, `accessCodeHash` sha256, `bannedJudges` judge names), `contestParticipations` (`virtual`: 0 live, -1 spectate, n virtual; `isRegistered` until the first join; live and frozen results), `contestSubmissions` (`_id` = submission id, points scaled to the contest problem); `users.currentParticipation`
- Rules live in `ContestAccess` (`core/contest-access.ts`): `canSee`, `canEdit`, `visibleFilter`, scoreboard and `canSeeFullSubmissionList` checks; viewer facts come from `ContestViewerService`; invisible or unknown contest -> 404 (also a malformed key), state conflicts -> 409
- Current participation is checked on read (`CurrentContestService.current`): ended or invisible contest -> pointer cleared (compare-and-set). Its scope feeds `ProblemAccess.canSee/visibleFilter`: before the start every problem is hidden, after it the contest's problems are visible. `/api/v2` applies no contest scope (legacy parity)
- Formats: a `ContestFormat` (`parseConfig`, `score`, `firstSolveTime`) in `libs/contests/src/formats/<kebab-case-name>.ts` (`final-submission.ts` for `final_submission`), registered in `FORMATS` (`registry.ts`); names `default ioi ioi16 icpc vnoj ultimate final_submission`; scored through `scoreParticipation(rows, { name, config }, context)`; configs are camelCase, validated on every write (400 `formatConfig`); `labelStyle` (`numeric|alpha`) replaces legacy Lua label scripts
- Freeze (`icpc`, `vnoj` only): absolute, contest end - `frozenLastMinutes`, and it stays after the end; an editor unfreezes by setting `frozenLastMinutes` to 0. Non-editors get only frozen fields and cells (`standingOf`, never mixed with live ones) in rankings and participations, own row included; editors always see live data
- Submit inside a current contest that lists the problem: priority 0, `lockedAfter` for live participations, pretests flag, `maxSubmissions` (IE and PD excluded) checked under the per-user lock; FSO submissions skip the unfinished limit; a running FSO contest stores `PD`: no bridge command, no event. The bridge reads banned judges, pretests and `in-contest` from Mongo at load and claim
- Effects: `SubmissionEffectsService.applyContest` rescales the contest submission (`contestSubmissionPoints`), `recomputeParticipation` (coalesced per participation) rewrites results and drops the four ranking keys
- Rescore: `contest-rescore {contestId}` (no `jobId`, one at a time) runs on `POST /:key/rescore`, disqualifications, problem rescores, and contest edits that change `scoringOf` (editing service): format, format config, `startTime`, `endTime`, `frozenLastMinutes`, `pointsPrecision`, or the problems' id, points, partial or order. Every edit purges the ranking keys; other edits do not rescore
- Ranking (`GET /:key/ranking`): one indexed read of the contest's rows, sorted in memory (`compareStandings`, competition ranks 1, 1, 3; ties in participation id order), cached per `{withVirtual, frozen}` for `scoreboardCacheTimeout` s with single-flight builds per api process; editors, own-row boards (viewer may not see the full board) and a 0 timeout bypass the cache
- Submission lists: `GET /:key/submissions` filters by contest and shows everyone's rows only when `canSeeFullSubmissionList` (never during a freeze unless editor), else the viewer's own (403 for another `user`). Other users' submissions of contests whose full list the viewer may not see leave `/api/internal/submissions`, `/api/v2/submissions` and the detail (403)
- FSO (`final_submission`): delayed job `final-judge-<contest>-<endTime ms>` rescheduled on create and edit, one-minute sweep over contests holding `PD` rows, `POST /:key/judge-final` (ended FSO contests only, else 409; ignores `autoJudge`); each run is serialised per contest, requeues each `PD` row once at priority 3 and skips rows rejected with `RJ`; a single rejudge of a `PD` row is 409; leaving `final_submission` while rows are `PD` is 409
- Access codes (`contests/core/rate-limits.ts`): wrong codes 10 per user and 30 per IP per 10 min on join and register (a missing code and a right one cost nothing); editors skip the code; virtual numbering retried up to 10 times
- Disqualify (`POST /:key/participations/:id/disqualify`, `{ disqualified }`): scores -9999 (frozen fields too), bans or unbans the user from the contest, clears the current pointer, queues a rescore. The `contest.banAfterDisqualifications` setting (0 = off) bans the account (`isActive` false, `isUnlisted`) at that many disqualifications outside organisation-private contests; lifting uses compare-and-set on the ban reason
- Legacy migration (migrator requirement): `formatConfig` keys `last_score_altering` -> `lastScoreAltering`, `auto_judge` -> `autoJudge`, `LSO` -> `lso`; drop `cumtime` on `final_submission`; format name `Ultimate` -> `ultimate`; Lua label scripts become `labelStyle`
- Deviations from legacy: `ultimate` takes the latest row (no double count on equal dates), writes its tiebreaker and rounds its score; FSO final judging requeues `PD` rows only; no fifth ranking sort key (`-submission_count`); frozen results never reach non-editors through `/api/v2` (legacy leaked them)

## Contest extras

- Rating: `POST /contests/:key/rate` (`judge.contest_rating` + edit rights, ended contest, 409 while the board is frozen; the worker also skips a frozen target and leaves frozen contests out of the re-rate chain and `/api/v2` rankings hide ratings on a frozen board; a rescore of a contest with ratings is the follow-up trigger) queues `contest-rating` (global concurrency 1); the job deletes every rating from the earliest of the target's end, its stored ratings' end and any moved contest's end, re-rates every rated contest from there in end order, then refreshes `users.rating`; `libs/contests/src/rating/elo-mmr.ts` is the legacy Python ported line for line
- Elo-MMR goldens: `python3 -I tools/legacy/elo_mmr_goldens.py <online-judge>/judge/ratings.py libs/contests/src/rating/elo-mmr.goldens.json`; generated, never hand-edited
- Public ranking: links (`/contests/:key/ranking-link`, `/public-rankings/:token`, 18-char tokens, misses limited per IP) and the ranking code (`?code=`); both serve `ContestRankingService.board`, frozen while frozen
- Official ranking: CMS CSV parsed at write (`ranking/official-ranking.ts`: 1 MiB, 10 000 rows, 105 columns) or a URL
- Announcements: rendered at save; pushed as ids on Redis `contest-events` to `GET /api/internal/events/contests/:key` (the one SSE hub, `contestTotal` cap, shared with the other contest events); pushes limited per contest
- Stats: `GET /contests/:key/stats`, gated by `canSeeFullSubmissionList` (never during a freeze for non-editors)
- Similarity: see "Similarity" below
- Data: `CONTEST_DATA_ROOT` (unset -> 404); one prepare per contest per 24 h unless the zip is missing; zip written to a per-run temp name, streamed with lazily fetched sources, capped in bytes and entries; download streamed by the api
- Clone: `POST /contests/:key/clone` (`judge.clone_contest` + edit rights on the source), hidden, cloner as only author
- `/api/v2/contests|contest/:key|participations`: legacy shapes; participations use `ContestAccess.scoreboardFilter` like contest detail, so hidden boards list no scores to non-editors (stricter than legacy) and standings are frozen for non-editors

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
- Ban (`judge.ban_user`, never yourself or a superuser): compare-and-set on `banReason`, unlisted, inactive, every session destroyed; the reserved automatic cheating reason cannot be used; unban restores rank `user`, listed and active whatever the user had before (legacy)
- User data: `USER_DATA_ROOT` (unset -> 404, muted -> 404); 3 prepares per user per day, one per 24 h while a fresh zip exists (`canPrepare`); zip (profile whitelist, own submissions with sources and `info.json`) kept 7 days, removed by the hourly sweep
- `/api/v2/organizations|users|user/:username`: legacy shapes, counted pages; unlisted organizations hidden like `canList`; contest ratings of frozen boards are `null` for non-editors
- Tests: `setupApiTest` exposes `organizations`, `organizationRequests`, `userDataRoot`; `setupWorkerTest` exposes `organizations`, `userDataRoot`

## Blog and comments

- Posts: `blogPosts` (`organization` null = personal), `blogVotes`; rules in `BlogAccess` (`blog/core/blog-access.ts`): `canSee` (published personal posts public; published organization posts to members; anything else to editors), `canEdit` (`judge.edit_all_post`; authors; organization posts: author + admin + `judge.edit_organization_post`), `canDelete` (+ `judge.delete_blogpost`); lists use its filters, never their own
- Writing: >= 10 solved or superuser and not muted (`canWritePersonalPost`), organization posts by their admins with `judge.edit_organization_post`; `globalPost` needs `judge.mark_global_post`, `sticky` `judge.pin_post`; `authorIds` `judge.edit_all_post`; rendered at save in the `blog` style; revisions `entity: 'blogPost'`; delete takes the post's votes, comments (and their votes) and lock in one transaction; creates and edits share 10 writes per hour per user (`blog-write:user:<id>`, moderators included)
- Comments: page `{type, id}` with `type` `problem | editorial | contest | blog | tagProblem` and the entity id; the API takes natural keys (`/comments/pages/:type/:key`). Every page check goes through `CommentPagesService.accessible`/`resolve`, which reuses `ProblemAccess` (with the current contest scope), `ProblemsService.editorialReadable` (never inside a contest), `ContestAccess.canSee` and `BlogAccess.canSee`; add a page type there and nowhere else
- Threads: `parentId`, `threadId` (root), `path` (ids joined by `/`, depth <= 100); roots newest first, 20 per page, replies in `path` order (all replies of the page's roots); hidden comments never listed; `collapsed` at score <= -5; a problem of the viewer's started contest shows no thread (`CommentsService.hidesThread`: empty page, 404 on detail, votes, revisions and edit, skipped in recent comments) unless `judge.override_comment_lock`
- Posting needs >= 5 solved or staff, not muted (`canInteract`), an unlocked page (`commentLocks`, `judge.override_comment_lock` passes; a problem of the viewer's started contest is locked too), a visible same-page parent younger than 365 days (`judge.change_comment` replies to older ones); 10 comments per 5 min per user; body <= 8192, `user` style (raw HTML escaped); edits are compare-and-set on `revisions` with a `revisions` row (`entity: 'comment'`)
- `judge.change_comment`: hide/unhide a subtree (`POST /comments/:id/hidden`; each hidden row records `hiddenBy` (the comment whose hide hid it) and unhiding a comment clears only the rows it hid, so comments hidden on their own stay hidden; unhiding under a hidden parent is 409), vote list, `PUT|DELETE /comments/pages/:type/:key/lock`; subtree writes use `subtreeFilter` (an `$or` of equality and a prefix regex, so the `path` index bounds it)
- Votes: `PUT .../vote {score: 1 | -1 | 0}` on posts and comments through `VotesService` (not own, `canInteract`, 60 per minute per user across both) and `VotesRepository.cast` (row and target `score` in one transaction; a vanished target is 404 and aborts); the route answers 404 for an invisible post or hidden comment before `cast`
- Contribution points: written only by the `contribution-points` job (coalesced per user, always recomputed and `$set`, never incremented), queued by votes, hide/unhide, post visibility/authors/deletion and a suggested problem's `publicityChanged`; good tickets count 10 each
- Official-contest mode (`contest.officialMode` setting on): non-superusers get 403 on comment pages, posting, editing and comment votes and on blog create/edit (also for moderation routes, before any write); blog reads and post votes stay; recent comments are empty
- Homepage `GET /home`: 10 recent comments (batched scan, <= 10 batches of 2 x limit, readable pages only, one contest scope per call; the anonymous slice is cached 60 s as `home:recent-comments`), 7 new public problems, top 5 by PP and by contribution, counts (`contests` = those an anonymous visitor can see); contests come from `GET /contests?phase=`
- Feeds `GET /feeds/:kind/:format` (`blog|comments|problems`, `rss|atom`): a signed-out viewer's view only, 25 items, cached 300 s (`feed:<kind>:<format>`); superagent buffers the feed content types, so tests call `.buffer(true)` to read `.text`
- Discord: `DiscordWebhooksService.notify(event, message)` (api) queues `discord-webhook` only when the `discord.webhooks` setting has a URL for the event or `default`; the worker reads the URL from that setting, never from job data or logs; payloads set `allowed_mentions` to none, a 4xx is not retried, redirects are refused; comments announce only pages a signed-out viewer can read, posts only once published and personal; organization and suggested problems on create
- User-data export includes the user's own comments (hidden ones too) and own or co-authored posts, streamed into the zip
- Tests: `setupApiTest` exposes `blogPosts`, `blogVotes`, `comments`, `commentVotes`, `commentLocks`; `setupWorkerTest` `blogPosts`, `comments`, `tagProblems`; fixtures in `apps/api/test/community-fixtures.ts`
- Site content (`modules/site/`, `public/` + `admin/`): staff routes under `api/internal/admin/site/{pages,navigation,config}` with `flatpages.add|change|delete_flatpage`, `judge.change_navigationbar`, `judge.change_miscconfig` (legacy Django names); pages are Markdown rendered at save in the `blog` style (urls `[-\w/.~]` only) with `revisions` rows (`entity: 'flatpage'`); navigation `path` must be a site path or http(s) URL and `regex` must compile (the SPA runs it), a parent must exist and never be a descendant, deleting an entry with children is 409; every navigation/config write resyncs its querier in this process and other processes follow the change stream (`BaseCatalogQuerier` applies deletes); misc config is public through `GET /site`: no secrets; last write wins
- Accepted residuals: navigation parent/children checks are not atomic (worst case an orphan or loop entry in the data; the server never walks the tree); the unhide-parent check is read-then-write (P9 race); hide/unhide is not atomic across the subtree and the vote scores; moderators share the blog write budget; `font-size` multipliers scale after the size check (containment covers it)

## Tickets and site content

- Tickets: `tickets` (messages embedded, at most 500, `messageCount` and `lastMessageAt` denormalized), `generalIssues` (`issueUrl`, http(s) only); `linkedItem {type: 'problem' | 'general', id}`. Who may read: `TicketAccess.canSee` (`judge.change_ticket`, creator, assignee, an editor of the linked problem via `ProblemAccess.canEdit`); the list uses `ProblemAccess.editableFilter`, which mirrors `canEdit` (a spec keeps them equal). Existing but unreadable ticket: 403; unknown or malformed id: 404
- Filing: `POST /problems/:code/tickets` (problem visible to the filer; assignees = contest authors when filed from a current contest that has the problem, else the problem's authors) and `POST /tickets/general`; muted users refused (no solved-problem minimum, official-contest mode does not apply); 5 tickets per 10 min and 30 messages per 10 min per user; bodies render in the `user` style at save
- `PATCH /tickets/:id` `{isOpen, isContributive, notes, assignees}`: open/close for anyone who may read, `isContributive` for `change_ticket` and never on one's own ticket, `notes` (visible to everyone who may read the ticket) editable by assignees and `change_ticket` holders, `assignees` (usernames) for staff; all permissions are checked before the single write; a good-ticket change queues the creator's contribution points (10 per good ticket, counted by the worker)
- Events: `TicketEventsService.publish` on `ticket-events` (`new-ticket`, `ticket-message`, `ticket-status`; ids only); `GET /events/tickets` and `GET /events/tickets/:id` are an `EventChannel` that judges every event per stream with `TicketAccess.canSee` and the stream's principal (refreshed by the hub's recheck)
- Discord: `on_new_ticket` and `on_new_ticket_message` through `DiscordWebhooksService` (legacy texts, `ticketMessageDescription`/`newTicketDescription`)
- Flatpages: `flatpages` with canonical urls (`/about`, no trailing slash; `normalizeFlatpageUrl`); `GET /pages/*` (public; `registrationRequired` and no session: 401); content is stored rendered. Navigation bar and misc config: `NavigationQuerier` and `MiscConfigQuerier` (`BaseCatalogQuerier`, 10 minute resync) behind `GET /site` (`{navigation, config}`, cached 60 s); navigation `regex` is JavaScript, evaluated by the SPA
- User activity: the `onResponse` hook (`UserActivityCaptureService`, registered by `UserActivityModule`, not by `configureApp`) buffers rows (5000 max, flush at 200 rows or 2 s, one write at a time, a failed batch is dropped and logged by error name and code only) into `userActivity`, upserts `userSessions` (key = `sha256`, see `activitySessionKey`), feeds the live Redis sorted sets (`active:users|anonymous|bots`, 30 min) and writes `users.lastAccess`/`users.ip` at most once per 5 min per user (`user-access:<id>` `SET NX EX 300`). Query strings, cookies and raw session ids are never stored; credential-in-path routes (`/public-rankings/<token>`, `/reset-password/<token>`, `/activate/<key>`) are redacted in paths and referers: extend `CREDENTIAL_ROUTES` in `libs/community/src/user-activity.ts`, the one list; both collections expire after 90 days (TTL indexes). Untracked paths: `isTrackedPath`
- Staff API `api/internal/admin/user-activity` (`judge.can_see_user_activity`): `logs` (page + `hasMore`), `logs/export` (CSV, at most 100000 rows, formula-safe cells), `users/:username/logs|summary`, `DELETE users/:username|anonymous`, `live`
- Site content staff API: see the `Site content` bullet under Blog and comments (flatpages use the `blog` style); admin screens read `GET /site` with `cache: 'no-cache'`, because the route is `private, max-age=60` and a plain read would show pre-edit data for up to a minute
- Tests: `setupApiTest` exposes `tickets`, `generalIssues`, `flatpages`, `navigationItems`, `miscConfigs`, `userSessions`, `userActivities`; `setupWorkerTest` `tickets`; fixtures in `apps/api/test/ticket-fixtures.ts`; `streamsOf` counts ticket streams too

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

Not migrated: `judge_contestmoss` (no mapper; see Similarity).

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

### Glossary

One name per concept. Rename only where a term is ambiguous, and never rename a wire field (DTOs, packets, job data, schema fields).

| Concept | Use | Not |
|---|---|---|
| A problem's public identifier | `code` on the Problem schema, in problem routes (`:code`) and inside `modules/problems`; `problemCode` anywhere another code is in scope (bridge, judge requests, submissions filters) | bare `code` next to an access code, error code or language key |
| A contest's public identifier | `key` | `code` |
| Access codes | `accessCode` (plaintext from the request), `accessCodeHash` (stored) | `code` |
| Database ids | `<entity>Id` (`userId`, `problemId`, `contestId`, `submissionId`); `_id` only on documents | `id` for a second entity in the same scope |
| A user in a role | `<role>Id`: `ownerId`, `authorId`, `requesterId`; schema fields keep their names (`user`, `suggester`, `authors`) | `user` for an id |
| The acting user | `principal: Principal` (identity and permissions); what services take | `auth`, `me`, `user` for the actor |
| The authenticated request | `auth: AuthContext` (`user`, `principal`, `session`, `sessionId`, `viaToken`); only where the session matters (cookies, CSRF, two-factor, impersonation) | passing `auth` just to read `auth.principal` in new code |
| The one a page is computed for | `viewer`: `ContestViewer` (their participation), `viewerStatus` (solved/attempted), `viewerScope` (their current contest) | `viewer` in a permission check (use `principal`) |
| Another user's public data | `profile` | `user` for the same shape |
| Problem test data | `data` (`ProblemData`: cases, checker, grader, archive) | `data` for anything else |
| Other payloads | `payload` (wire), `fields` (a DB patch), `dto` (a request body), `changes` (a diff) | `data`, `info`, `result` |
| Partial scoring | `partial`: a problem or contest problem scores per case | "partial" for anything else |
| A session still owing its second factor | "before two-factor": `AllowBeforeTwoFactor`, `twoFaPassed: false` | "partial auth" |
| Durations | a `Ms` or `Seconds` suffix on every number; a library option key (`delay`, `age`) takes a suffixed constant | bare `timeout`, `delay`, `ttl` |
| Problem limits | `timeLimit` in seconds, `memoryLimit` in KiB (schema and wire names) | other units without a suffix |
| Booleans | `isX`, `hasX`, `canX`, `shouldX`, `wasX`; a read that loads more takes `{ withX: true }` | adjective-only names (`hidden`, `frozen`), literal `true`/`false` as a positional argument |
| Pretests | `isPretested` (problem, contest problem, submission), `pretestsOnly` (judge request) | `pretested` outside the judge packet |

## Readability rules

- One job per function: if its doc comment needs "and" to say what it does, split it into named helpers.
- Length: aim for 40 lines or fewer; 80 is the hard limit (lint `error`, blank lines and comments not counted; specs exempt).
- Complexity: aim for 10 or less; 15 is the hard limit (lint `error`). Essential complexity — a protocol switch, a tokenizer — gets an inline `eslint-disable-next-line complexity -- <why>` instead of a split that reads worse.
- At most 4 parameters (lint `error`; Nest DI constructors and decorated handler parameters exempt): group the rest in an options object with named keys.
- Units in names: every duration ends in `Ms` or `Seconds`, every size in `Bytes` or `Kib`.
- Booleans read as questions: `isX`, `hasX`, `canX`, `shouldX`, `wasX`; never pass a literal `true`/`false` positionally — use `{ withCases: true }`. A `setX(…, value)` setter is the one exception.
- Guard clauses first: refuse or return early, then the main path at one indentation level.
- Comments say why (a legacy rule, a race, a bound), never what the next line does.

## Testing

- Unit: `<file>.spec.ts` next to the file under test; e2e: `apps/<app>/test/*.e2e-spec.ts` for apps, next to the file for libs
- Mongo: `startMongo()` from `@libs/database/testing` (in-memory replica set)
- HTTP: `createTestApp(moduleMetadata)` from `@libs/common/testing` (same pipes/filters/interceptor as prod)
- The whole `npm test` needs Redis (`TEST_REDIS_URL`, default db 15, which tests flush); migrator e2e also needs MariaDB (`TEST_MYSQL_URL`): `podman compose up -d mariadb redis` (or `docker compose`)
- Bridge e2e: `setupBridgeTest` (`apps/bridge/test/setup.ts`, millisecond `FAST_TIMINGS`, `restart()`), `FakeJudge` (real TCP), `RecordingJudge` (no socket); api specs read the command stream through `apps/api/test/submission-fixtures.ts`
- Index use is asserted with `profileQueries` (`@libs/database/testing`): no `COLLSCAN`, documents examined bounded; worker effects fixtures in `apps/worker/test/effects-fixtures.ts`; SSE through `apps/api/test/sse-client.ts` (supertest cannot read streams); `recordSubmissionEvents` (`@libs/judging/testing`)
- Worker: `setupWorkerTest` (`apps/worker/test/setup.ts`); zip fixtures via `buildZip` from `@libs/problems/testing`; `TEST_ENV` lives in `@libs/common/testing`
- Playwright specs skip without Chromium; the pandoc spec skips locally and fails in CI without pandoc
- Similarity specs spawn the real engine (about 1 s each); they need the grammars compiled by `npm ci`
- Legacy fixtures in `test/fixtures/` are generated, never hand-edited: `tools/legacy/run.sh` (`CONTAINER=docker` to override podman)
- `libs/<lib>/src/testing.ts` is the lib's only test-support entry (`@libs/<lib>/testing`), imported by specs and `apps/*/test` only; lint refuses it in production code. Keep it one file per lib; when it outgrows one screen, add a sibling file under `libs/<lib>/src/testing/` and re-export it from `testing.ts`, so the import path never changes.

## Commands

| Command                   | Purpose                                                                       |
| ------------------------- | ----------------------------------------------------------------------------- |
| `npm test`                | Jest, runs in band                                                            |
| `npm run format`          | Prettier write on `apps/` and `libs/`                                         |
| `npm run lint`            | ESLint (+ Prettier) on `apps/` and `libs/`                                    |
| `npm run test:openapi`    | the OpenAPI coverage spec with the swagger plugin (see OpenAPI)               |
| `npm run seed:e2e`        | idempotent dev/e2e seed (see Seed script)                                     |
| `npm run typecheck`       | `tsc --noEmit`                                                                |
| `npm run build`           | build `api`                                                                   |
| `npx nest build migrator` | build migrator                                                                |
| `npx nest build worker`   | build worker                                                                  |
| `npx nest build bridge`   | build bridge                                                                  |
| `npx nest start api`      | run the API                                                                   |
| `npx nest start bridge`   | run the bridge                                                                |
| `npx nest start worker`   | run the worker (from the repo root: KaTeX's CSS resolves from `node_modules`) |

CI (`.github/workflows/ci.yml`): lint, typecheck, test, all four builds.

## Env and deploy

- `PROBLEM_DATA_ROOT`, `PDF_CACHE_ROOT` are required by the api, the worker and the bridge (all validate env); the migrator reads only `MONGO_URL` and `LEGACY_*`
- The api and the worker share `MEDIA_ROOT`, `PROBLEM_DATA_ROOT`, `PDF_CACHE_ROOT`
- `PROBLEM_DATA_ROOT` and `PDF_CACHE_ROOT` must not be under `MEDIA_ROOT` (served publicly); boot checks only `CONTEST_DATA_ROOT` against it, the others are the operator's to keep apart
- `CONTEST_DATA_ROOT` is shared by the api and the worker and must not be under `MEDIA_ROOT`
- `USER_DATA_ROOT` is shared by the api and the worker; boot rejects it under `MEDIA_ROOT` or overlapping `CONTEST_DATA_ROOT`
- The `contest.officialMode` setting (on) locks profile `about` and `firstName`, comment pages, posting, comment votes and blog writing for non-superusers
- Moved to admin settings (see Runtime settings; `GET /api/internal/admin/settings`, `PATCH .../<key>`, needs `judge.change_settings`): `site.timeZone` (new), `mail.smtpUrl`, `mail.from`, `auth.google`, `auth.facebook`, `auth.github` (social login), `auth.pwnedApiUrl`, `discord.webhooks`, `pdf.renderTimeoutMs`, `pdf.maxBytes`, `contest.officialMode`, `contest.banAfterDisqualifications`. Boot logs one warning (`Ignoring X, Y: these are admin settings now ...`) naming any of their old variables still set (`REMOVED_ENV` in `libs/common/src/env/removed-env.ts`) and ignores them (no env fallback); the values are never logged
- Mail locally: `docker compose up -d mailpit`, then either `npm run seed:e2e` (sets `mail.smtpUrl` to `smtp://localhost:1025` when no row exists) or, as a user with `judge.change_settings`, `PATCH /api/internal/admin/settings/mail.smtpUrl` with `{"value":"smtp://localhost:1025"}`; until `mail.smtpUrl` is set, registration answers 503 `mail_unavailable`; password reset and activation resend answer 204 and the mail is lost (logged)
- `discord.webhooks` (api and worker): a map of `default` or `on_<event>` keys (`on_new_comment`, `on_new_blogpost`, `on_new_problem`, `on_new_suggested_problem`, `on_new_ticket`, `on_new_ticket_message`) to https URLs (http only for `localhost`/`127.0.0.1` outside production, see Runtime settings); empty sends nothing; the worker needs outbound HTTPS to Discord
- nginx: serve `/media/submission_file/` with `Content-Disposition: attachment`, `Content-Security-Policy: sandbox` and `X-Content-Type-Options: nosniff` (file submissions are user bytes stored under their language's extension, which may be `html`, `svg` or `xml`; `nosniff` alone does not stop those). Judges must reach `SITE_URL` + `MEDIA_URL` over HTTP(S): the bridge sends the absolute file URL
- nginx: map the legacy `/feed/<blog|comment|problems>/<rss|atom>/` to `/api/internal/feeds/<blog|comments|problems>/<rss|atom>`
- The `.hint()` queries (organization members, submissions, comment threads) throw until their indexes exist: build them before serving (mongoose `autoIndex` or the migrator's `syncIndexes`); the leaderboards are not hinted but are only fast with theirs
- Worker memory limit: about 2 GB x job concurrency (Chromium, pandoc), plus up to 2 GiB for the similarity engine child (V8 heap cap, not a hard cap; native parser memory comes on top)
- The worker runs one similarity job at a time (queue concurrency 1)
- Worker image and CI need `python3`, `make` and `g++` at `npm ci`: the tree-sitter grammars of `@dodona/dolos-parsers` are compiled by node-gyp (never `--ignore-scripts`); the child resolves `@dodona/dolos-lib` itself, so the worker does not depend on its working directory
- Bridge: `JUDGE_BRIDGE_HOST`, `JUDGE_BRIDGE_PORT` (default 9999); exactly one instance
- The bridge port must be reachable only from judge hosts (firewall)
- Judge containers need a restart policy (the judge-server fork exits on a broken connection)
- The qhhoj/judge-server fork must handle submission ids (UUID strings) as strings everywhere: the `%d` of the grading `Process` name in `judge.py` is fatal, `%d` in `packet.py`/`judge.py` log calls and the `int` annotations of `Submission.id`/`abort_grading` are not; the bridge is not deployable until it does
- Streams: nginx must not buffer `/api/internal/events/` (`proxy_buffering off`; the api also sends `X-Accel-Buffering: no`) and needs `proxy_read_timeout` well above the 15 s heartbeat
- Worker tuning: `pdf.renderTimeoutMs` and `pdf.maxBytes` (settings), `PDF_CONCURRENCY` (env); the Polygon import queue runs one job at a time

## Commits

- One-line conventional subject: `feat: ...`, `fix: ...`, `docs: ...`, `refactor: ...`, `test: ...`, `chore: ...`
