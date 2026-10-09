# qhhoj-backend

## 2.0.0

- Rewrite of the Django/MariaDB site as NestJS 11 on Fastify with Mongoose 8 on a MongoDB 8 replica set (UUIDv7 `_id`s), Redis and BullMQ; big-bang cutover, no dual writes.
- `apps/migrator` CLI backfills and verifies MariaDB data in MongoDB; Django permission codenames and `pbkdf2_sha256`/`pbkdf2_sha1` hashes are kept (rehashed on login).
- Auth: Redis sessions keyed by `sha256(cookie)`, `X-CSRF-Token` plus `Origin` check on unsafe methods, Bearer API tokens, Have I Been Pwned password check.
- `apps/bridge` is the judge TCP server (DMOJ protocol); `apps/worker` runs BullMQ jobs (PDF render, Polygon import, rescoring, ratings, code similarity, and others).
- Runtime configuration is split: env holds infrastructure and secrets, everything else is an admin setting (`/api/internal/admin/settings`); the OpenAPI document is committed as `openapi.json`.
- Removed: legacy `/api/v2`, integer-id URLs and legacy API tokens, IP auth, `atcoder` and `ecoo` contest formats, clarifications.
