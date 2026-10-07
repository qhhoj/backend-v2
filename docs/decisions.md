# Design decisions

Decisions that still hold in the code, with the reason. Conventions and how-tos are in [CONTRIBUTING.md](../CONTRIBUTING.md).

## Program

- Big-bang cutover, old stack runs until the switch — one migration rehearsal path, no dual writes.
- MongoDB replica set with UUIDv7 `_id`s everywhere — transactions and change streams; UUIDv7 sorts by time, so lists sort by `-_id`.
- Django permission codenames kept as strings on users and groups — migrated data and checks keep their meaning.
- `/api/v2` keeps legacy envelope and field names with UUID ids; the SPA uses `/api/internal` — old API consumers keep working.
- Legacy integer-id URLs and API tokens are not carried over — handled later if needed.
- Dropped from the legacy site: IP auth, Lua label scripts, `atcoder` and `ecoo` contest formats, clarifications, the per-problem `shortCircuit` field — unused or a security/runtime cost.

## Foundation and auth

- Case-insensitive unique fields use collation `{locale: 'en', strength: 2}` — matches Django's behaviour.
- Pino through Fastify's own logger instead of `nestjs-pino` — fewer dependencies, same JSON output with request ids.
- `fastify` pinned to one copy — a duplicate copy breaks type identity with `@nestjs/platform-fastify`.
- `TRUST_PROXY` is `false` or an address list, never `true` or a hop count — per-IP rate limits would trust spoofed forwarded headers.
- Env is validated at boot — fail fast instead of a half-working process.
- `@nestjs/schedule` 6.x, `bullmq` 5.81.5, `@nestjs/bullmq` 11.0.5, `@fastify/cookie` 11.0.2, `sanitize-html` 2.17.5 pinned — newer majors are ESM-only and break Jest CJS and Nest 11 (`@nestjs/schedule` follows `^6.1.3`, the rest are exact).
- Passwords: verify Django `pbkdf2_sha256`/`pbkdf2_sha1` of any iteration count, rehash to 870000 on login — existing users log in with old passwords.
- Django's common-password list dropped; Have I Been Pwned range check instead — the HIBP list covers it; a pwned hit forces a password change.
- Login verifies the password before revealing a ban — the old site leaked ban state to anyone who knew a username.
- Login rate limit reserves a hit first and releases on success, per IP and per resolved account — only failures consume budget and concurrent guesses cannot race past the limit.
- Unknown usernames are limited per NFKC-lowercased name — avoids probing with case and Unicode variants.
- Wrong-password checks run a dummy PBKDF2 when the account is missing or the hash is malformed — no timing oracle for account existence.
- Sessions live in Redis keyed by `sha256(cookie)` with a per-user set — revoke-all is one lookup and a stolen Redis dump holds no usable cookies.
- Session cookie is `HttpOnly; SameSite=Lax`, state-changing requests carry `X-CSRF-Token`, and unsafe methods check `Origin` against `SITE_URL` — login has no session yet, so the `Origin` check is what protects it.
- API tokens (Bearer) skip CSRF, 2FA and pwned gates but cannot reach `@SessionOnly()` routes — a leaked token cannot change the password or mint a new token.
- The API token stays valid after a password change — documented choice; the holder cannot rotate credentials.
- An invalid Bearer token is 401 even on `@Public` routes — fail closed.
- TOTP and WebAuthn share one failure budget — a second factor cannot be brute-forced by alternating methods.
- TOTP rejects steps at or before `lastTotpTimecode` — a code cannot be replayed.
- TOTP secrets and scratch codes are AES-256-GCM encrypted at rest; the migrator will decrypt the legacy Fernet format (planned, migrator deferred) — a database leak does not leak second factors.
- 2FA enrolment and credential removal need `currentPassword` and are blocked while impersonating — a hijacked session cannot add its own second factor.
- Password change writes with optimistic concurrency (409) and rejects the same password — a race cannot overwrite a freshly changed password.
- Registration creates an inactive user plus a hashed activation key; no resend endpoint — not needed.
- Password reset tokens are bound to the stored hash and `lastLogin` — single use without a token table; it also lets migrated social-only users set a first password.
- Social login state is bound to the browser by a cookie and the signup continuation by a second cookie — a stolen link cannot finish another browser's signup.
- Impersonation: active superusers only, never onto a superuser or nested, and the guard rechecks the impersonator on every request — rights loss ends the session at once.
- Session data goes through Redis cjson — no integers of 15+ digits, no arrays, `null` instead of `undefined`.
- `withRedisLock` is fail-fast (409 on contention) — a double click gets a conflict instead of queueing behind itself.
- ESLint `id-length` minimum 2 and one class per file named `<name>.<role>.ts` — readability rule for a team.

## Migrator

- Backfill is incremental and re-runnable: stable `migrationIdMap`, upsert by `_id`, `--fresh` to empty — a full backfill runs ahead of time, delta catch-up and a short final run at the switch.
- `verify` rebuilds the expected document from source rows and deep-compares — counts alone miss field drift.
- Planned (migrator deferred): migrated stale-pending accounts must be marked before the reclaim job runs — otherwise legacy admin-deactivated accounts get deleted.
- Planned (migrator deferred): migrated submissions need `casePoints`/`caseTotal`, and a full recompute follows the backfill — schema defaults make 0/0 rows look solved.
- Planned (migrator deferred): contest `formatConfig` keys are camelCased on migration, `cumtime` dropped on `final_submission`, `Ultimate` lowercased, Lua label scripts become `labelStyle` — the v2 schema rejects the legacy spellings.
- The migrator never loads `Env` — it needs only `MONGO_URL` and `LEGACY_*`.

## Problems

- Statements render at save and the HTML is stored; reads never render — fast reads, one render budget per write.
- Render limits (markdown size, formulas, KaTeX output, tags, nesting, HTML size) are enforced and fail as 400 — a hostile statement cannot cost unbounded CPU.
- Markdown via `markdown-it` tuned to legacy `markdown2` output, KaTeX on the server, `sanitize-html` with the legacy allow-list; `problem-full` is unsanitized and needs `judge.problem_full_markup` — legacy parity with a permission around the unsafe path.
- Math spans are protected before Markdown and an unknown macro stays as raw TeX in `math-error` — a bad formula never fails a save.
- One rule set, `ProblemAccess`, for list, detail and `/api/v2`; the legacy quirk that admins do not see private problems in lists is dropped for a `visibility` filter — one source of truth.
- `visibleFilter` is only used in `find`/`count`, never in an aggregate — aggregate pipelines would need a different shape.
- Invisible or unknown problem is 404, visible but not editable is 403 — existence is not leaked.
- Catalog data (types, groups, licenses, languages, tags) is querier-backed and never deleted — small, hot, rarely changing.
- Uploaded file type is decided from the bytes; SVG is sanitized; nginx serves `/media` with `nosniff`, `attachment` for materials and a CSP sandbox — uploads cannot run script in the site origin.
- Test data stays on a shared volume, `PROBLEM_DATA_ROOT/<code>/`, as the judge contract; `init.yml` is generated from the embedded case list — the judges are unchanged, the DB is the source of truth.
- `init.yml` is written atomically (temp + rename); compile errors go to `data.feedback` and remove `init.yml` — a judge never reads a half-written or invalid config.
- Per-case bridged checkers are rejected (only the global custom checker is valid) — a legacy bug fixed.
- Zip uploads are bounded (entries, total size, per-entry size, ratio) and reject symlinks and path tricks — zip bombs and traversal.
- A code rename moves the data directory through the `codeRenamed` listener and drops cached PDFs; a rename during an import fails that import — the import's compare-and-set filters on `code`.
- Polygon import runs in the worker with pandoc under `prlimit --as=768MiB`, one job at a time, and reports through the job id — conversion cannot exhaust the box; a missing `prlimit` fails closed.
- Statement PDFs: Playwright job in the worker, cache `PDF_CACHE_ROOT/<code>.<lang>.pdf`, 202 while rendering, 503 with `Retry-After` on failure — render cost stays off the API.
- Tagging needs `allowTagging` plus `judge.add_tagproblem` or rating >= 1900; no external OJ calls — legacy rule, no outbound dependency.

## Judging and bridge

- Judge protocol is the DMOJ protocol of the qhhoj judge-server fork, with submission ids as UUID strings — the fork must not treat ids as ints.
- Mongo is the queue truth (`QU` plus `priority`); the bridge claims QU -> P before sending and the in-memory queue is rebuilt on start — a bridge restart loses nothing and never ends in IE.
- API -> bridge commands go over a Redis stream, fire-and-forget; a lost `judge` command waits for the bridge's resync — no RPC coupling, Mongo is the backstop.
- Every packet's write filters `{_id, judgedOn, status}` — stale or duplicate packets are no-ops.
- Packets for a submission the judge is not working on are ignored, and grading packets before `grading-begin` are ignored — a judge that kept grading across a bridge restart must not poison the next submission; only a wrong `submission-acknowledged` is IE plus close.
- Pre-handshake packets are capped (4 MiB compressed, 8 MiB inflated), anything but `handshake` closes, JSON depth is limited, and unauthenticated sockets are capped per address — unauthenticated memory and CPU stay bounded. The bridge port is reachable only from judge hosts.
- Flood cap is 1000 packets/s and the idle clock pauses while a packet is handled — batch traffic from a real judge must not trip it.
- Case text is clipped by UTF-8 bytes (512, feedback 50) at a code-point boundary and cases are capped at 10000 — a submission document stays well under Mongo's 16 MB.
- Source length counts code points, not UTF-16 units — legacy Python `str` semantics; schema and DTO use one `codePointLength`.
- Judge key is compared in constant time against a sha256 hash; keys are shown once; block and rotate force-disconnect — a leaked or rotated key stops working immediately.
- Resync reconciles connected judges with Mongo (blocked, rotated key, disabled) and requeues P/G rows that no connected judge holds for two consecutive ticks — covers lost commands without requeueing in-flight work.
- Disconnect requeues once, the second disconnect on the same submission is IE; a rejudge restores the allowance — poison submissions cannot loop forever.
- Dispatch: lowest load among capable free judges, random tie-break; a rejudge does not take the last capable free judge; mirrors dispatch under `mirrorRoot`'s code — rejudges cannot starve normal submissions.
- Priorities 0 contest, 1 normal, 2 rejudge, 3 batch rejudge, FIFO by id — UUIDv7 order is time order.
- Unfinished-submission limit is counted under a per-user Redis lock; `judge.spam_submission` bypasses — a burst of parallel submits cannot exceed the limit.
- Submission detail and source require the problem to be visible (404), owner included — a hidden problem's data does not leak through an old submission.
- Case output is shown unless `testcaseVisibility` is `O` (editors always) — default author-only problems must not leak outputs.
- Detail loads the thin row, checks access, then loads cases only when needed — avoids hydrating 10000 cases for a request that will be refused.
- Abort of a running submission is best-effort; the user aborts again — a lost `abort` would otherwise need a reliable channel.
- Bulk rejudge counts first (more than 10 needs `judge.rejudge_submission_lot`), then streams ids in chunks of at most 1000, skips locked rows without `force` — no full materialisation.
- The bridge is a single instance; the API and bridge refuse to boot while Redis is down (boot ping) — the orchestrator restarts them.
- Judge containers need a restart policy — the fork exits on a dropped socket.

## Effects and realtime

- Effects recompute from Mongo and `$set`, never increment; `runCoalesced` serialises one key across processes, extends its lock while running and reruns for marks left meanwhile — duplicate and retried jobs are harmless, bursts collapse.
- A sweep every 10 min recomputes users and problems with recently judged submissions, with a watermark set only after success (at most 24 h back) and a 10 min overlap — recovers lost `submission-graded` jobs.
- `submission-graded` is enqueued through `notifyGraded` with a 1 s bound, errors logged — a Redis outage must not block grading or the API; the sweep repairs the gap.
- Effects, sweep and rescore processors start only after the submission indexes exist (`startAfterIndexes`) — hinted queries throw before the index is built.
- User points: best per problem over public non-org-private problems, PP = sum of 0.98514^rank * points over the first 300 plus 0.05 per solved — legacy `calculate_points`; solved is AC with `casePoints >= caseTotal`.
- Problem stats exclude unlisted users; an AC counts only when `points >= problem.points` — legacy `update_stats`.
- Org PP is deferred to the organizations sub-project.
- Rescore is queue-driven (`problem-rescore`), not an in-process event — the worker cannot reach the API's `ProblemEvents`; writes filter on the case totals read, so a rejudge that finished meanwhile keeps its points.
- Rescore uses `submissionPoints` (round after the ratio times points, as at grading end) — legacy rounded the ratio first; one rounding rule everywhere.
- `viewerStatus` is computed per page with one aggregate, not cached — no cache invalidation to get wrong.
- Events are Redis pub/sub carrying ids and status only, published by whoever writes the status, fire-and-forget and skipped while Redis is not ready — a Redis problem never fails a write; streams are never the source of truth.
- Status changes the bridge makes without a judge (start, resync) publish `queued` — open pages stay correct.
- SSE: the stream registers before reading state, rechecks access every 60 s, and sends `resync` after a lost subscription — no event gap between snapshot and live.
- SSE client limits: per user, per IP, total, feed and contest caps; slow clients are dropped on sustained backlog (2 s) or at once above 256 KiB; hijacked replies skip `onSend`, so streams never refresh the session cookie — memory stays bounded.
- Case events stream only when every case result is visible to the viewer; the public feed covers public non-org-private problems with no cases — no leak through progress events.

## Contests

- Seven formats (`default`, `ioi`, `ioi16`, `icpc`, `vnoj`, `ultimate`, `final_submission`), one pure module each, validated config on every write — table-testable against legacy.
- `ultimate` writes `tiebreaker` (legacy wrote `tiebreak`), takes the latest row on equal dates (no double count) and honours `pointsPrecision` — legacy bugs fixed.
- No fifth ranking key `-submission_count`; ties fall back to participation id — deterministic order.
- `labelStyle` `numeric|alpha` replaces Lua label scripts — sandboxed Lua is a security and runtime cost.
- Contests embed at most `MAX_CONTEST_PROBLEMS` (100) unique problems — bounded document.
- Contest duration limit 14 days — legacy `VNOJ_CONTEST_DURATION_LIMIT`.
- Current contest is `users.currentParticipation`, validated lazily on read with compare-and-set — no per-request middleware.
- A current contest feeds `ProblemAccess`: before the start every problem is hidden, after it the contest's problems are visible whatever their own publicity; the editorial is 404 while in a contest — legacy parity. `/api/v2` applies no contest scope, as legacy.
- Contest submission list is filtered by contest, not by problem visibility or the viewer's scope — the legacy `ForceContestMixin` behaviour; access is still gated by contest rules.
- Access codes are hashed and compared in constant time; wrong guesses are rate limited per user and per IP, correct or missing codes cost nothing; editors skip the code — blocks guessing without punishing normal flow.
- A join after the registration window by an unregistered user is 409; `isRegistered` replaces the 1970 sentinel and is live-only.
- Attempt number counts within the participation — legacy semantics.
- A running final-submission (FSO) contest stores `PD` rows without sending them to the bridge; one delayed job `contest-final-judge` at `endTime` plus a 1-minute sweep requeues them at priority 3 — legacy's five trigger paths collapse into one.
- A single rejudge of a `PD` row is 409, bulk rejudge excludes `PD`, final judging skips rows already rejected, and leaving `final_submission` while `PD` rows exist is 409 — FSO judging owns those rows.
- The FSO queue-limit skip depends on the format, like legacy `in_fso_contest`.
- Contest effects ride the existing `submission-effects` job and recompute a participation through `runCoalesced` — one scoring path.
- Rescore (`contest-rescore`) runs on edits that change `scoringOf` (format, config, times, freeze, precision, problem id/points/partial/order) and on disqualification; other edits only purge the ranking keys — rescoring is expensive (about 34 s at 12k participations).
- Ranking is computed from participation fields and ordered `isDisqualified, -score, cumtime, tiebreaker`; the cache key is `{withVirtual, frozen}` with single-flight builds, every recompute purges all four keys — legacy left frozen keys stale; editors and own-row boards bypass the cache.
- Freeze applies to `icpc` and `vnoj` only, stays after the end (editors set `frozenLastMinutes` to 0 to unfreeze), and non-editors only ever see `frozen*` fields, also through `/api/v2` and participations — legacy `/api/v2` leaked live standings.
- Hidden scoreboards list no scores to non-editors in `/api/v2` participations — stricter than legacy, consistent with the freeze stance.
- Disqualify sets score -9999, bans the user from the contest, clears the current pointer, queues a rescore and re-rates when ratings exist; auto-ban after N disqualifications is off by default (`CONTEST_BAN_AFTER_DISQUALIFICATIONS`), lifts by compare-and-set on the ban reason, reconciled from the final `isDisqualified` — concurrent opposite requests converge and a manual ban is never lifted.
- Rating is Elo-MMR ported line for line (goldens generated from the legacy Python), queued by an editor or by the rescore of a contest that has ratings, one job at a time; it deletes and re-rates from the earliest affected end time in one Mongo transaction — a re-rate after any contest edit keeps later contests consistent.
- `contest-rescore` of a contest that has ratings enqueues `contest-rating` — the single trigger after disqualifications and scoring or end-time edits (broader than legacy); an end-time edit queues no rating itself, and the rating run's start moves earlier until it covers contests whose end moved.
- Rating is never computed from a frozen board: `POST /rate` answers 409 while the contest is frozen, the worker skips a target frozen at run time (logged), and `/api/v2` rankings return `old_rating`/`new_rating` null on a frozen board — ratings follow live standings and would reveal the hidden winner.
- MOSS: `MOSS_API_KEY` is set on the api (it gates the routes) and the worker (it runs the job), never in job data or logs; clearing results answers 409 while the job exists; one run per contest; results replaced only after every batch succeeds; per-batch wall-clock deadline plus idle timeout — a drip-feeding server cannot hang the job.
- Contest data download: zip written to a per-run temp name, sources fetched lazily, capped in bytes and entries, prepared at most once per 24 h unless the zip is missing; the root is outside `MEDIA_ROOT` — the zip is served by the API, never directly.
- Public ranking links use 18-char tokens with per-IP miss limits; both links and ranking codes serve the same `board` — frozen while frozen.
- Official ranking CSV is parsed at write with fixed size, row and column caps; the body limit is raised only on that route (and the problem data upload route).
- Announcements are rendered at save and pushed as ids over Redis `contest-events` and the shared SSE hub — one streaming stack for submissions and contests.
- Clarifications dropped (no rows in production).

## Deploy

- Worker image needs pandoc >= 3, util-linux `prlimit` and Chromium; plan about 2 GB of memory per job of concurrency — PDF and Polygon conversions are memory hungry.
- API and worker mount the same `MEDIA_ROOT`, `PROBLEM_DATA_ROOT`, `PDF_CACHE_ROOT` and `CONTEST_DATA_ROOT`; `PROBLEM_DATA_ROOT` and `PDF_CACHE_ROOT` are not checked against `MEDIA_ROOT` at boot, only `CONTEST_DATA_ROOT` is; none of the last three may sit under it — it is served publicly.
- nginx: `proxy_buffering off` and a long `proxy_read_timeout` on `/api/internal/events/`; set `TRUST_PROXY` to nginx's address — streams need it, per-IP limits are meaningless otherwise.
- Docker Compose stack: apps, MongoDB replica set, Redis, nginx; one bridge instance; all sessions are invalidated once at cutover.
