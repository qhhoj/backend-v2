# Contributing

## Stack

- Node 22, TypeScript 5 (`tsconfig.json`, CI uses Node 22)
- NestJS 11 on Fastify (`@nestjs/platform-fastify`)
- Mongoose 8 via `@nestjs/mongoose`; MongoDB 8 **replica set** (change streams)
- Redis 7, MariaDB 11 (legacy source for the migrator only)
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
  auth/       auth features (groups/ querier), crypto
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
- File names: `<feature>.<role>.ts`, role in `controller|service|querier|repository|module|schema|dto|mapper|command|filter|interceptor|pipe|error|spec`
- One exported responsibility per file; subdocument classes and small helper types may live with their owner
- Scope: a file exporting a class is `<name>.<role>.ts` with role = class suffix (`IdMapRepository` -> `id-map.repository.ts`); function/type modules and entry points (`main.ts`, `index.ts`, `testing.ts`, `uuid.ts`, `schema.ts`, `crypto.ts`, `mapper.ts`, `bootstrap.ts`) use a plain noun
- Exception: `pipes/validation.pipe.ts` exports a configured instance, not a class
- Tests: `<file>.spec.ts` / `<file>.e2e-spec.ts` next to the file under test
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

## Data conventions

- `_id` is a UUIDv7: declare `@IdProp() _id!: string`
- Helpers (`@libs/database`): `newId()` new id string, `uuidStr(value)` Binary -> hex string, `toUuid(id)` string -> BSON `UUID` for raw driver queries
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

- Unit: `<file>.spec.ts`; e2e: `<file>.e2e-spec.ts`, both next to the file under test
- Mongo: `startMongo()` from `@libs/database/testing` (in-memory replica set)
- HTTP: `createTestApp(moduleMetadata)` from `@libs/common/testing` (same pipes/filters/interceptor as prod)
- Migrator e2e needs MariaDB (`TEST_MYSQL_URL`): `podman compose up -d mariadb` (or `docker compose`)
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
