# qhhoj-backend

## 2.6.0

### Minor Changes

- ae7e208: Polygon follow-ups: sync history (`GET /polygon/syncs`, `GET /problems/{code}/polygon/syncs`; one `polygonSyncRuns` row per finished Polygon job with requester, package, result, failed step and error); import job status gains `failedStep`; `polygon.apiKey` is now a sealed secret (reads `{set}`, the existing plain row keeps working until the next save, old revision rows are redacted); package responses gain `createdAt`, the link gains `title` and `packageCreatedAt`.

## 2.5.3

### Patch Changes

- 17566cd: Polygon imports: statements are always rendered sanitized, a sync re-checks the linking user's rights, and the images one import re-hosts are capped at 64 MiB in total.

## 2.5.2

### Patch Changes

- 40ec7e4: Auth: login failures are counted per IP and per (account, IP), so failures from elsewhere no longer lock an account out. `POST /auth/token/regenerate` now requires `currentPassword`, and a password change or `logout-all` revokes the API token.
- 77a9c98: Submissions: the public feed's delivery queue is bounded (drops and sends `resync` when backed up), and the detail's `currentTestcase` is null unless the viewer sees every case result.

## 2.5.1

### Patch Changes

- 4d4105e: Deploy: install-host.sh creates problem-data as 2750 again so the local judge can read it through group qhhoj.
- 0f844a2: Comments: edits are limited to 20 per 5 minutes per user, and a page lists at most 100 replies per thread (`truncatedThreads` names the threads cut).
- 4af72ac: Render: the raw-HTML math scan runs in linear time, and statement iframes are always sandboxed with `allow` limited to `fullscreen`.

## 2.5.0

### Minor Changes

- 5c84fa7: Add `GET /api/internal/problems/{code}/best-submissions`: each user's best submission on a problem, ranked by points, time, memory and date.
- 119b776: Contest list rows and the contest detail now carry `organizations` (slug and name) for the organizations an organization-private contest is restricted to.
- dac4ed3: Submission stats: `verdictsToday`, today's judged submissions counted by result (one aggregate over the `judgedDate` index, cached with the other figures).

### Patch Changes

- b3af799: Test: a moderator's hide on a problem page answers the hidden comment with `hiddenBy`, and the page listing still returns it to them flagged hidden.
- 89978b2: Deploy hardening: memory caps on the api and bridge units, nginx cannot read problem/user/contest data or the PDF cache, port 80 no longer redirects to the client-supplied Host, the CSP script hash matches index.html, and qhhoj-deploy pins PATH.

## 2.4.0

### Minor Changes

- cb1885c: Comments: Markdown preview, delete (author or moderator, placeholder kept), reports with a moderator queue, hidden comments listed to moderators with who hid them, `postBlock` reason and `pageLocked` on the page listing, comment location for `#comment-<id>` links, and a stable per-page `number`.

## 2.3.1

### Patch Changes

- bd5d4de: Remove the finished old-site migration tooling: the migrator app, `qhhoj-migrate`, the worker `migration-recompute` job, the legacy fixtures and the MariaDB test dependency.

## 2.3.0

### Minor Changes

- 262ce35: Polygon integration: admin settings `polygon.apiKey`, `polygon.apiSecret` (encrypted), `polygon.accountName`; `GET /polygon/status`, `POST /polygon/test`, `GET /polygon/problems`, `POST /polygon/problems/{polygonId}/import`; `GET|PATCH|DELETE /problems/{code}/polygon` and `POST /problems/{code}/polygon/sync`; a 10-minute auto-sync worker job. Import job status gains `step` (queued, downloading, statements, tests, done, failed) and `progress`.
- cbe4f79: Every user reference (`UserSummaryResponse`), the session user, balloon teams, contest participations and the staff user list carry `rating` (null when unrated), so clients colour names by tier.
- a783f97: removed the unused navigation bar admin
- 0192eef: Submission list items carry `problem.points`, the problem's max points (the denominator of a score).

### Patch Changes

- 8a09f53: API reference: summaries and descriptions for accounts, users, site, sync, short-link, notification and home endpoints.
- dce495e: API reference: summaries and descriptions for contests, organizations, blog, comments and tickets endpoints.
- 746448e: API reference: summaries and descriptions for problems, submissions, judging, judges, similarity and tags endpoints.
- e8c244b: `GET /home` `counts.problems` counts every live problem (archive size), not only public ones.
- 5c6f092: frontend deploy keeps the last 14 days of the kept releases' hashed assets in the new release, so open tabs on an older build no longer 404 on lazy chunks
- 24ce416: Problem search matches substrings of the code and titles (every word, accent-insensitive) instead of whole words.
- 9627284: `GET /users` accepts `sort=contributionPoints` (descending, ties share a rank, same as the other boards).

## 2.2.0

### Minor Changes

- 5b7563b: `GET /api/docs`: browsable API reference (Scalar) rendering `/api/internal/openapi.json`; the bundle is served from the api itself, no third-party script or font.

### Patch Changes

- fbf7f46: security: the public submission feed and the public solved/pp-breakdown pages leave out contest submissions the anonymous submission list hides (running, frozen, hidden-board or private contests).
- 1cf9799: Backend fixes from the site review:

  - Organizations: a direct join honours `slots` (409 `organization_full`); an approval decides the request before adding the member, so a concurrent rejection never leaves a member.
  - Blog: `summary` and `ogImage` need `judge.edit_all_post` to be set or changed.
  - Contests: editors and testers joining an ended contest spectate instead of becoming virtual contestants.
  - Auth: the session offers WebAuthn only when the user has a stored key (a legacy flag alone no longer locks the user out); staff with `judge.ban_user` can `POST /users/:username/reset-two-factor` (audit-logged, signs the user out); the password-reset and activation-resend email budgets ignore surrounding spaces; password reset and activation resend answer 503 `mail_unavailable` while SMTP is not configured.
  - Judging: a run still held by a judge past a deadline (`runMarginMs` + time limit x `runCaseBudget`) is aborted and requeued once, then IE; a queued submission pinned to a judge that has been absent for `pinFallbackMs` falls back to any judge.
  - Problems: `PATCH` with `date: null` clears the publish date.

## 2.1.0

### Minor Changes

- 368727a: Continuous deployment: a release tag builds the image, pushes it to GHCR and deploys it through `qhhoj-deploy` after CI passes; the `deploy` workflow also rebuilds and deploys any ref by hand. A running contest defers the restart unless forced.
- 66061ba: Container image (`Containerfile`): api, bridge, worker and migrator in one image selected by `APP`, with Chromium, pandoc 3.1.3 and prlimit; runs as uid 987.
- 2c32656: `GET /api/internal/problems/random`: the code of one random visible problem matching the list filters (404 `no_problem` when none). `random` is now a reserved problem code.
- 67fb537: Unlimited quota promotion: organizations imported from the old site get `quotaUnlimited`, which lifts the credit and storage limits (usage is still metered); usage responses carry `unlimited` and staff can end it through `PATCH /organizations/:slug/quota`.

### Patch Changes

- 9fc1b63: Deploys defer (exit 75) while a migration or another deploy holds the lock, and only for contests ending within 24 h; a failed deploy resets systemd start limits, health-checks the restored version, and the frontend check is file-only until nginx serves v2. A resumed go-live keeps its pre-start dump, and the maintenance and preview pages keep the security headers.
- f7a02ad: Runbook: container install, CD, and the freeze-and-iterate migration week (qhhoj-migrate).
- 8e8b403: install-host.sh sets up a host for the container deploy (users, directories, units, sudoers, maintenance page); service uid/gid is 987.
- ee5f8e7: Migration tooling: `qhhoj-migrate snapshot` takes a frozen, read-only copy of the old site's database and files into the migration work dir.
- 3473f9a: Migrator no longer imports the legacy blog; comments, comment votes and locks on blog pages are skipped and reported.
- 14093f9: Statement rendering matches the old site: quotes, `...` and `--` stay as written; `##Title` without a space is a heading; a code fence right after an HTML line (`<details>`) renders as code; `$…$`/`~…~` inside raw HTML blocks (tables, lines after an `<img>`) render as math; a formula holding a lone backtick run (`~\texttt{``}~`) renders. nginx serves legacy `/martor/` image URLs from `/media/martor/`.
- 5f04366: Math in raw HTML blocks is never looked for inside a quoted attribute value (`<img alt=">$x$">`). A line starting with `#word` (`#include …`) outside a code fence is a heading, as on the old site.
- ab608eb: The base statement language is Vietnamese: `?lang=vi` (now the default) returns the base statement with `translated: true`; `?lang=en` without an English translation returns the Vietnamese base with `translated: false`. PDF cache keys of base statements move from `<code>.en.pdf` to `<code>.vi.pdf` (re-rendered on demand). The migrator drops a legacy `vi` translation identical to the problem's own text.

## 2.0.0

- Rewrite of the Django/MariaDB site as NestJS 11 on Fastify with Mongoose 8 on a MongoDB 8 replica set (UUIDv7 `_id`s), Redis and BullMQ; big-bang cutover, no dual writes.
- `apps/migrator` CLI backfills and verifies MariaDB data in MongoDB; Django permission codenames and `pbkdf2_sha256`/`pbkdf2_sha1` hashes are kept (rehashed on login).
- Auth: Redis sessions keyed by `sha256(cookie)`, `X-CSRF-Token` plus `Origin` check on unsafe methods, Bearer API tokens, Have I Been Pwned password check.
- `apps/bridge` is the judge server speaking gRPC `qhhoj.judge.v1` (contract vendored from `judge-v2` into `libs/judge-proto`) to the Rust judge `judge-v2`; the DMOJ protocol and judge-server are gone. `apps/worker` runs BullMQ jobs (PDF render, Polygon import, rescoring, ratings, code similarity, and others).
- Runtime configuration is split: env holds infrastructure and secrets, everything else is an admin setting (`/api/internal/admin/settings`); the OpenAPI document is committed as `openapi.json`.
- Removed: legacy `/api/v2`, integer-id URLs and legacy API tokens, IP auth, `atcoder` and `ecoo` contest formats, clarifications.

### Judging and bridge

- Judges connect over gRPC `qhhoj.judge.v1`: TLS unless the port is loopback, `x-judge-name`/`x-judge-key` metadata checked before any message; runs resume after a reconnect within a 30 s grace and a bridge start no longer requeues P/G rows.
- Link limits: one connection and one handshake per judge, an idle connection closes after 15 s, block, key rotation or forced disconnect ends every session of the judge, an address with 20 failed key checks a minute is refused and logged.
- An abort handled after a judge's stream died sticks: a resumed run is aborted after the Welcome, or ends AB when the grace expires; a grace expiry whose write fails is retried at the next expiry.
- A submit with `judgeId` stores the pin (`pinnedJudge`) and keeps it across accept timeouts, resyncs and restarts; a judge loss, RETRY or rejudge clears it.
- Finished submissions carry `effectsDueAt` until the graded job applied the effects; the worker's effects sweep re-applies rows still due after 2 minutes, so a bridge crash between verdict and job no longer leaves a scoreboard stale.
- Operational logs for connects and disconnects, RETRY reasons, grace holds, accept timeouts and sockets that close before authenticating; server-side failures name submission, generation and seq.
- `FetchSource` closes the file handle only after the stream closes; the shared Redis client closes last on shutdown.
- Migrator: `prune-languages --keep KEY,... [--dry-run]` removes languages no judge runs from problems and disables the row (rows are kept, past submissions keep their language; refuses a keep list with no runtime language or an unknown key); `stamp-data-versions [--root DIR] [--dry-run]` writes `<code>/.data-version` (never lowers) and lists symlinked problems; `count-data-shapes` reports bridged checkers and exits 1 when a Pascal or Java checker needs a testlib judge-v2 does not ship.
- The DMOJ dev judge (`judge:up`/`judge:down`) is removed; the local judge is judge-v2 (`judge:v2:up`).

### Problems

- Soft delete: `DELETE /problems/:code` (confirm by code; `judge.delete_problem` plus edit rights; 409 `problem_in_contest`), `POST /problems/:code/restore`, `GET /problems/deleted` (with `daysLeft`), superuser `POST /problems/:code/purge-now`. Deleted problems vanish from lists, search, detail (404) and contests; their codes stay reserved (`deleted`, `meta`, `imports` are refused as new codes). Delete and restore recompute solver counters through the `problem-solvers-recompute` job.
- Daily `problem-purge` job (03:30): after `problem.deleteGraceDays` (default 30) a problem loses its data directory, PDFs, packages, uploads, comments and revisions and becomes a tombstone; submissions are kept. A died purge is finished by the next sweep; a symlinked data directory is refused.
- Submissions of a deleted or purged problem render `problem.isDeleted` for their owner and `judge.view_all_submission` holders, without case detail; rejudge and reject answer 409 `problem_deleted`.
- Package download for editors: `POST /problems/:code/package` queues a build, `GET` serves the zip; the cache is LRU and dropped by PDF and material uploads and code renames.
- A contest save that a delete overtook is refused and undone; delete and restore drop the public feed's cached eligibility; upload deletes refuse a symlink out of `MEDIA_ROOT`.

### Contests

- Rules: `rules` (Markdown, up to 8192 characters) with `rulesHtml` and `rulesRevision` (rises only when the trimmed text changes); `acceptRules` on `register` and `join` (400 `rules_not_accepted`), stored as `rulesAcceptedAt` and `rulesAcceptedRevision`.
- Tag catalogue: `GET /contest-tags` and `POST|PATCH|DELETE` (`judge.change_contest_tag`), colours are theme token keys, at most 100 tags (409 `tag_limit`); editor tags are validated against it (400 `unknown_tag`). `grant-permissions` gives the codename to `judge.edit_all_contest` holders.
- The overview shows each problem's `timeLimit` and `memoryLimit` (null when hidden from the viewer).
- Publishing after the end: `POST /contests/:key/publish-problems` (with `editorials`, `dryRun`; 5 an hour per user, refunded on failure; skip reasons `no_permission`, `organization_private`, `not_found`, `deleted`; 409 `contest_not_ended`). The `publishAfterEnd` switch makes the worker publish for the recorded editor and keep the outcome; clone turns it off.
- Replay: the worker builds a chunked replay (real and ghost events) of an ended, settled contest; `GET /contests/:key/replay` (202 `building`), `POST .../replay/rebuild` (3 an hour, refunded when not queued); rescore rebuilds it; late verdicts queue a rebuild; Redis failures answer 404 `replay_not_ready` or 503 `replay_unavailable`; same-second events keep submission order.
- Ghosts: editors import from CSV (preview, anonymise, 1 MiB cap), list, download (UTF-8 BOM) and delete under `/contests/:key/ghosts`; refused imports list problems in `error.issues[]`.
- Balloons: `balloons` switch and `balloonStaff` fields (clone clears them), `canViewBalloons`; `GET /contests/:key/balloons` and `deliver|undeliver`, derived from live scores, hidden solve times while frozen.
- Submissions export: `GET|POST /contests/:key/export` and `/export/download` (zip of `submissions.csv` and sources, once a day after the end, editors only, formula-safe cells); the problem deleted since keeps its rows, not its sources.
- ICPC event feed: snapshot `GET /api/internal/contests/:key/feed` and stream `GET /api/internal/events/contests/:key/feed` (NDJSON, HTTP Basic feed key; live non-disqualified teams; cut at the freeze until released; 409 `feed_too_large` over 100 000 submissions; two streams per key, closed on revoke). Keys: `GET|POST|DELETE /contests/:key/feed-key` and `/release` (editors, own session, five mints an hour). A shared build failure retries on the next tick; set `TRUST_PROXY` behind nginx.
- `GET /contests/:key/actions` reports `replay`, `export`, `publish` and `autoPublish`.
- Official-contest mode: badge and organization-order changes and organization join, leave and request answer 403 `locked_in_official_contest` (superusers exempt); `GET /site` gains `officialMode` and `officialModeEndsAt`, switching off at the end time.

### Organizations and quota

- Per-organization problem tags, a problem list with tag, archive and search filters, bulk archive and tag actions, the `archived-in` notice, the quota usage dashboard, staff overview and `PATCH /organizations/:slug/quota`.
- Credits: organization-private contests (create, clone, first scoping) and organization problems (create, suggest, clone, test archive upload) spend credits, refunded on failure; uploads past the storage limit are refused; two concurrent scoping edits charge once; `dataBytes` is recorded after every data write, with a one-off `problem-databytes` backfill that enables `quota.enforce = enforce`.
- Admins get one `quota-warning` notification per month and meter at 80%; a limit of 0 reports near and over. A nightly (03:00) usage audit logs `organization.usage.drift` and never changes data.
- OpenAPI: the tag colour enumeration is one `TagColor` schema.

### Tickets and notifications

- Notifications: per-user inbox (list, unread count, mark read, mark all read) with live nudges on `GET /events/user`; contest announcements and decided join requests notify; the fan-out is idempotent and the nightly trim covers every user over the cap; default SSE caps leave 500 slots for submission and ticket streams.
- Tickets notify owner, assignees (or `change_ticket` staff) with one merged row per ticket; detail has a `timeline` (newest 200); `GET /api/internal/tickets/summary` returns `{assignedOpen, awaitingStaff}`; `lastMessageByStaff`; a muted user gets 403 `forbidden` with issue code `muted`.
- Canned replies: up to 100 shared answers at `/api/internal/ticket-canned-replies` (`judge.change_ticket`).

### Integrations

- `/api/internal/integration-clients` (session-only, `judge.manage_integration`): `qhi_` keys shown once, scopes, CIDR allow-list, acting user, optional `expiresAt`, idempotent revoke. `@ServiceOnly()` routes accept only `qhi_` keys (sha256-stored, constant-time, CIDR- and scope-bound); failed keys lock an address out for 10 minutes after 20 tries.
- Sync API v1 `/api/sync/v1/contests/:key`: `PUT` (`?dryRun=true`; `created`, `updated`, `unchanged`), `GET`, `DELETE` (409 `contest_not_deletable`), `PUT .../participants` (never creates users), `GET .../standings`. Contests are hidden and private, owned through `managedBy`; a started contest is 409 `contest_frozen`; another owner's key is 404; the acting user is re-checked on every request; 60 requests a minute per client.
- Short links: `POST/GET/DELETE /api/internal/short-links` and public `GET /s/:code` (302, hit counting); `judge.manage_short_link` holders choose code and expiry; a past expiry is 400.

### Fixes

- Every 4xx refusal carries `error.issues[]` (including auth guard, permissions and rate limiter); an oversized body answers 413 `payload_too_large`.
- A failed final-judge job removal still schedules the new job; a failing effects repair is logged once an hour.
