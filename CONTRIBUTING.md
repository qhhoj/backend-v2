# Contributing

## Stack

- Node 22, TypeScript 5 (`tsconfig.json`, CI uses Node 22)
- NestJS 11 on Fastify (`@nestjs/platform-fastify`)
- Mongoose 8 via `@nestjs/mongoose`; MongoDB 8 **replica set** (change streams)
- Redis >= 7 (the rate limiter uses `EXPIRE ... NX`), MariaDB 11 (legacy source for the migrator only)
- Jest 29 + `mongodb-memory-server`; ESLint + Prettier
- Versions pinned in `package.json`; `fastify` pinned via `overrides` to a single copy; bump when `@nestjs/platform-fastify` or an advisory requires it
- Local services: `docker-compose.yml` (`mongo`, `redis`, `mariadb`, `mailpit`); env vars in `.env.example`

## Layout

```
apps/
  api/        HTTP app (Fastify): AppModule, main.ts, health.controller.ts
  migrator/   CLI (nest-commander): MariaDB -> MongoDB backfill/verify
libs/
  common/     http layer (AppError, filter, interceptor, pipe), bootstrap, BaseMongoStreamQuerier
  database/   uuid helpers, schema helpers, SCHEMAS, DatabaseModule
  auth/       groups, password, token, session, principal, users, guards, decorators, crypto, AuthModule
test/fixtures/  legacy MariaDB dump (legacy.sql, django.json)
tools/legacy/   regenerates the fixtures
```

- Aliases: `@libs/common`, `@libs/database`, `@libs/auth` (and `@libs/<name>/*`) -> `libs/<name>/src`
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
- File names: `<feature>.<role>.ts`, role in `controller|service|querier|repository|guard|decorators|module|schema|dto|mapper|command|filter|interceptor|pipe|error|spec`
- One exported responsibility per file; subdocument classes and small helper types may live with their owner
- Scope: a file exporting a class is `<name>.<role>.ts` with role = class suffix (`IdMapRepository` -> `id-map.repository.ts`); function/type modules and entry points (`main.ts`, `index.ts`, `testing.ts`, `uuid.ts`, `schema.ts`, `crypto.ts`, `mapper.ts`, `bootstrap.ts`) use a plain noun
- Exception: `pipes/validation.pipe.ts` exports a configured instance, not a class
- Tests: unit specs `<file>.spec.ts` next to the file under test; app e2e specs in `apps/<app>/test/*.e2e-spec.ts`, library e2e specs next to their file (e.g. `libs/common/src/http-layer.e2e-spec.ts`)
- Schemas are shared: `libs/database/src/schemas/<entity>.schema.ts` (not per feature)
- Reference: `libs/auth/src/groups/` (module + querier + spec)

## Querier vs repository

| | Querier | Repository |
|---|---|---|
| Data | small, simple, read often, never deleted | everything else |
| Storage | in-memory copy | Mongoose queries |
| Freshness | change stream + cron resync | always live |
| Base | `BaseMongoStreamQuerier` | `@InjectModel` |

- Reference: `libs/common/src/querier/base-mongo-stream.querier.ts`, `libs/auth/src/groups/groups.querier.ts`
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
- App wiring: `configureApp(app)` + `fastifyAdapter()` from `@libs/common` (used by `main.ts` and tests)

## Auth

- Every route is authenticated by default (global `AuthGuard`); opt out with `@Public()`
- Decorators: `@AllowPartialAuth()` (before 2FA), `@AllowPwnedPassword()`, `@SessionOnly()` (Bearer -> 403 `forbidden`; used on password change, token regenerate, logout-all, the 2FA enrol/disable/credential routes and impersonation start/stop), `@NoImpersonation()` (403 `forbidden` while impersonating; 2FA enrol/disable/credential routes, password change, token regenerate), `@RequirePermission('judge.<codename>')`, param `@CurrentAuth()` -> `AuthContext`
- Origin rule: unsafe methods without a Bearer header must carry no `Origin` or exactly the `SITE_URL` origin, else 403 `csrf_failed`; checked first, even on `@Public` routes. The session cookie is re-issued once a day while the session is active
- Guard order: Origin check -> authenticate (Bearer, else session cookie; an invalid Bearer token is rejected 401 even on `@Public` routes) -> cookie refresh -> `@Public` exit -> `unauthorized` -> `@SessionOnly` -> CSRF (`csrf_failed`) -> 2FA (`two_factor_required`) -> pwned password (`password_change_required`) -> `@NoImpersonation` (`forbidden`) -> permission (`forbidden`)
- Error codes: `unauthorized` 401, `invalid_credentials` 401 (login) / 400 (password change), `csrf_failed` 403, `two_factor_required` 403, `password_change_required` 403, `forbidden` 403, `banned` 403, `account_not_activated` 403, `rate_limited` 429, `validation_failed` 400, `conflict` 409, `not_found` 404, `not_impersonating` 400, `invalid_token` 400 (activation/reset/social token), `invalid_code` 400 (TOTP/scratch code), `totp_not_enabled` 400, `webauthn_not_enabled` 400, `webauthn_failed` 400, `mail_unavailable` 503
- SPA contract: cookie `qhhoj_session`; send `X-CSRF-Token` (from `/auth/me` or login) on POST/PUT/PATCH/DELETE
- API tokens (Bearer) skip the CSRF, 2FA and pwned-password gates but cannot reach `@SessionOnly()` routes; the token stays valid across a password change (design choice)
- Login rate limiting is reserve-then-release, per IP plus per resolved account; unknown usernames are limited per NFKC-lowercased name
- Behind nginx set `TRUST_PROXY` to its address (e.g. the container network CIDR); otherwise every client shares one IP and the per-IP login limit becomes global
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

## Data conventions

- `_id` is a UUIDv7: declare `@IdProp() _id!: string`
- Helpers (`@libs/database`): `newId()` new id string, `uuidStr(value)` Binary -> hex string, `toUuid(id)` string -> BSON `UUID` for raw driver queries
- UUID arrays on hydrated docs (`user.groups`, ...): index access, spread and `toJSON()` give strings, but `.map/.filter/.flatMap/.slice` give raw buffers; map through `uuidStr` first
- `@Schema({ ...baseSchemaOptions, collection: '<name>' })`: timestamps, no `__v`, `toJSON` returns `id` instead of `_id`
- Case-insensitive unique fields: `ciIndex(Schema, 'field')` and query with `.collation(CI)` (see `libs/database/src/schema.spec.ts`); `ciIndex(schema, field, unique = true)`, e.g. `ciIndex(UserSchema, 'email', false)` for non-unique
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
| `npx nest start api` | run the API |

CI (`.github/workflows/ci.yml`): lint, typecheck, test, both builds.

## Commits

- One-line conventional subject: `feat: ...`, `fix: ...`, `docs: ...`, `refactor: ...`, `test: ...`, `chore: ...`
