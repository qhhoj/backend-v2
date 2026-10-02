# Sub-project 1: Foundation

Workspace, Postgres schema, migration pipeline, `db` and `auth` crates, API skeleton, CI.
References like `profile.py:241` are in `qhhoj/online-judge/judge/models/`.

## Layout

```
crates/db/              PgPool, row types, queries
crates/auth/            passwords, sessions, tokens, 2FA, WebAuthn, OAuth, permissions
crates/api/             Axum router, extractors, errors, OpenAPI
crates/migrate-tools/   audit + verify (MariaDB + Postgres)
bin/qhhoj/              serve | migrate | import audit | import verify
migrations/             0001_baseline.sql, ...
tools/baseline/         regenerates 0001 from the old repo
tests/fixtures/django/  golden values from Django
docker-compose.yml      Postgres 17, Redis 7, Mailpit, MariaDB (tests)
```

Config (env): `DATABASE_URL`, `REDIS_URL`, `LEGACY_SECRET_KEY`, `EXTERNAL_JUDGE_ENCRYPTION_KEY`, `SITE_URL`, `WEBAUTHN_RP_ID`, SMTP, OAuth credentials.

## Baseline schema

`tools/baseline/generate.sh`:
1. Run `manage.py migrate` of the old repo (pinned commit) on empty Postgres 17. Skip `RunSQL` in 0085, 0089, 0090, 0198 (MySQL-only data updates).
2. `pg_dump --schema-only`, post-process, write `migrations/0001_baseline.sql`.

Post-processing:

| Change | Columns |
|---|---|
| `text`→`jsonb` | `judge_contest.format_config`, `judge_contestparticipation.format_data` |
| `varchar`→`citext` | `auth_user.{username,email}`, `judge_organization.slug`, `judge_problem.code`, `judge_contest.key`, `judge_contesttag.name`, `judge_problemtype.name`, `judge_problemgroup.name`, `judge_license.key`, `judge_language.key`, `judge_judge.name`, `judge_taggroup.code`, `judge_tag.code`, `judge_tagproblem.code`, `judge_navigationbar.key`, `judge_externaljudgeconfig.name` |
| GIN index | `judge_problem`: `to_tsvector('simple', code \|\| ' ' \|\| name \|\| ' ' \|\| description)` |

Tokens stay case-sensitive `varchar`. `datetime`→`timestamptz`. Encrypted `BinaryField`→`bytea`.

## Migration pipeline

1. `qhhoj import audit` (fails on errors, prints warnings):
   - schema drift: missing tables/columns, nullability mismatch
   - zero dates, invalid JSON, case-only duplicates in citext columns
   - password hash algorithms other than `pbkdf2_sha256`, `pbkdf2_sha1`, `!`
   - `judge_webauthncredential` row count
2. `pgloader migrate/load.pgl`: data only; zero dates→`NULL`, `tinyint(1)`→`boolean`, `longblob`→`bytea`, JSON text→`jsonb`; reset sequences.
3. `qhhoj import verify`: per table, row count + SHA-256 over PK-ordered normalized rows; prints first 20 mismatched PKs.

Rehearsals use a production dump (not in git, not in CI).

## Auth

### Passwords
- Verify `pbkdf2_sha256` and `pbkdf2_sha1`, any iteration count. `!` prefix = unusable.
- Hash new passwords as `pbkdf2_sha256`, 870000 iterations. Rehash on login if fewer.
- Django default validators + Have I Been Pwned range check; pwned at login sets `password_pwned` (forced change).

### Sessions, CSRF
- Same origin (nginx serves SPA, proxies `/api`).
- Cookie `qhhoj_session`: 256-bit random, `HttpOnly; Secure; SameSite=Lax`.
- Redis `session:<sha256(id)>`, sliding 14-day TTL: `{user_id, profile_id, two_fa_passed, password_pwned, impersonator_id?, csrf}`. Per-user session set for revoke-all.
- Mutating requests require `X-CSRF-Token` = session `csrf` (from `GET /auth/me`). Bearer requests exempt.

### Login
- Case-insensitive username.
- `is_active=false` + `ban_reason` → 403 `banned` with reason; inactive otherwise → 403 `account_not_activated`.
- TOTP or WebAuthn enabled → `two_fa_passed=false`; all endpoints except 2FA and logout return 403 `two_factor_required`.
- Rate limit: 10 failures / 15 min per IP and per username.

### API tokens (`profile.py:412`)
- Client: `base64url(pack('>I32s', user_id, secret))`.
- Stored: `hex(HMAC-SHA256(LEGACY_SECRET_KEY, secret))` in `judge_profile.api_token`.
- `Authorization: Bearer` → 2FA passed; no management endpoints.

### TOTP, scratch codes
- `totp_key`, `scratch_codes`: keep django-fernet-fields format. Key = HKDF-SHA256(`LEGACY_SECRET_KEY`, salt `django-fernet-fields-hkdf-salt`, info `django-fernet-fields`). No re-encryption (`LEGACY_SECRET_KEY` is required anyway for API tokens and WebAuthn handles).
- Window ± `DMOJ_TOTP_TOLERANCE_HALF_MINUTES`; reject time steps ≤ `last_totp_timecode` (`profile.py:444`).
- Scratch codes: 16-char base32, encrypted JSON list, single use.
- Enable (pending secret in session), refresh codes, disable (requires code).

### WebAuthn
- `webauthn-rs`, RP ID `WEBAUTHN_RP_ID`.
- User handle: `HMAC-SHA256(LEGACY_SECRET_KEY, "webauthn:" + profile_id)` (`profile.py:496`).
- Table `judge_webauthncredential` (cred_id base64url no padding, public_key, counter).
- Current site uses the webauthn 0.x API with 3.0 installed (likely broken). If audit finds existing credentials, add a task to decode their `public_key` format.

### Registration, reset
- Register: inactive `auth_user` + `judge_profile` + `registration_registrationprofile` (hex SHA-256 key, 7-day expiry). Email unique, case-insensitive. SMTP via `Mailer` trait; Mailgun route and newsletter → sub-project 5.
- Reset token: `base64url(user_id, ts, HMAC(LEGACY_SECRET_KEY, user_id‖password_hash‖last_login‖ts))`, 3 days. Old-site reset links invalid. 10 requests/IP/hour.

### Social login
- Google, Facebook, GitHub (`oauth2` crate).
- Match `social_auth_usersocialauth` (provider, uid) → else by verified email → else prompt username + password, create user + profile (`judge/social_auth.py`).
- OAuth state in Redis, 10 min.

### Impersonation
- Superuser only. `POST /auth/impersonate/{id}` sets `impersonator_id`; `POST /auth/impersonate/stop`. Requests logged with both IDs.

### Permissions
- `Principal { user_id, profile_id, is_superuser, is_staff, perms, org_ids, admin_org_ids }`.
- `perms` = `judge.<codename>` from user + group permissions; superuser passes all. Redis cache 5 min, invalidated on change.
- `perm!` macro checks codenames at compile time against a list generated from `auth_permission`.
- Object-level checks (`is_editable_by`, `is_accessible_by`) ported with their features.

### Not ported
IP auth (`judge/ip_auth.py`): inactive in settings; column kept.

## API

- Axum 0.8, `tower-http` (tracing, compression, request ID, timeout), `utoipa` → `/api/internal/openapi.json` (frontend client generated from it).
- Error body: `{"error": {"code": "...", "message": "...", "fields": {...}?}}`.
- Extractors: `Principal`, `RequireUser` (enforces 2FA, pwned flag), `RequirePerm`, `Pagination`.
- Redis fixed-window rate limiter.
- Endpoints (`/api/internal/auth/`): `me`, `login`, `logout`, `logout-all`, `register`, `activate`, `password/{change,reset,reset/confirm}`, `2fa/totp/{verify,enable,confirm,disable,scratch/refresh}`, `2fa/webauthn/{register/begin,register/finish,login/begin,login/finish,delete}`, `social/{provider}/{start,callback}`, `social/complete`, `impersonate/{id}`, `impersonate/stop`. Plus `GET /healthz`.
- `/api/v2` and OG `index.html`: mount points only (501).

## Errors, logging

- `thiserror` per crate; `ApiError` → JSON body. Internal errors return `internal_error` + request ID.
- `tracing`: JSON in prod. Log login, 2FA failure, password change, impersonation with user + IP.

## Testing

- `tools/fixtures/generate.py` (old repo env, fixed test secret) → `tests/fixtures/django/*.json`: password hashes, Fernet ciphertexts, API token pairs, WebAuthn handles, TOTP codes. Rust must reproduce/verify all.
- Unit: auth primitives.
- Integration (`sqlx::test`, Postgres + Redis): all auth endpoints incl. banned, unactivated, 2FA, CSRF, rate limit; OAuth via mock provider.
- Migration: audit + verify in CI against a synthetic MariaDB fixture (zero date, invalid JSON, case-duplicate email, encrypted bytes, non-pbkdf2 hash).
- CI: `fmt --check`, `clippy -D warnings`, `test`, sqlx offline check, `0001` applies on empty Postgres.

## Needed before first rehearsal (not blocking)

- Production MariaDB version and dump for rehearsal.
- Production `LEGACY_SECRET_KEY` and `EXTERNAL_JUDGE_ENCRYPTION_KEY` (deploy secrets).
- WebAuthn credential count.

## MySQL-specific SQL (for later sub-projects)

| Location | Issue | Sub-project |
|---|---|---|
| `views/ranked_submission.py:57,63` | `STRAIGHT_JOIN` | 2 |
| `utils/raw_sql.py:42,76` | raw subquery join, `STRAIGHT_JOIN` | 2 |
| `dblock.py` | `LOCK TABLES` | 5 |
| `template_context.py:68` | `REGEXP BINARY` | 5 |
| `fulltext.py:42` | `MATCH … AGAINST` | 3 |
| `admin/contest.py:471` | `TRUNCATE` with backticks | 7 |
| `contest_format/{icpc,atcoder,vnoj}.py` | non-grouped columns in `GROUP BY` | 4 |
