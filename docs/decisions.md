# Design decisions

Decisions that still hold in the code, with the reason. Conventions and how-tos are in [CONTRIBUTING.md](../CONTRIBUTING.md).

## Program

- Big-bang cutover, old stack runs until the switch — one migration rehearsal path, no dual writes.
- MongoDB replica set with UUIDv7 `_id`s everywhere — transactions and change streams; UUIDv7 sorts by time, so lists sort by `-_id`.
- Django permission codenames kept as strings on users and groups — migrated data and checks keep their meaning.
- `/api/v2` (legacy read-only API) removed: no external consumer; the SPA uses the main API.
- Legacy integer-id URLs and API tokens are not carried over — handled later if needed.
- Dropped from the legacy site: IP auth, Lua label scripts, `atcoder` and `ecoo` contest formats, clarifications, the per-problem `shortCircuit` field — unused or a security/runtime cost.

## Foundation and auth

- Case-insensitive unique fields use collation `{locale: 'en', strength: 2}` — matches Django's behaviour.
- Pino through Fastify's own logger instead of `nestjs-pino` — fewer dependencies, same JSON output with request ids.
- `fastify` pinned to one copy — a duplicate copy breaks type identity with `@nestjs/platform-fastify`.
- `TRUST_PROXY` is `false` or an address list, never `true` or a hop count — per-IP rate limits would trust spoofed forwarded headers.
- Env is validated at boot — fail fast instead of a half-working process; a variable that became a setting only logs one warning (names, never values) and is ignored — an old `.env` must not stop a deploy or keep a stale value alive.
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
- Security keys are listed by `GET /auth/2fa/webauthn/credentials` (registration order, no credential id or public key), session-only and refused while impersonating; no rename route (not needed by the UI).
- Password change writes with optimistic concurrency (409) and rejects the same password — a race cannot overwrite a freshly changed password.
- Registration creates an inactive user plus a hashed activation key; `POST /auth/activate/resend` replaces the keys of a pending account and always answers 204 — a lost mail needs a way out, and resend adds no account-existence oracle (`POST /auth/register` still answers `email_taken`, limited to 5 per hour per IP).
- Password reset tokens are bound to the stored hash and `lastLogin` — single use without a token table; it also lets migrated social-only users set a first password.
- Social login state is bound to the browser by a cookie and the signup continuation by a second cookie — a stolen link cannot finish another browser's signup.
- Impersonation: active superusers only, never onto a superuser or nested, and the guard rechecks the impersonator on every request — rights loss ends the session at once.
- Session data goes through Redis cjson — no integers of 15+ digits, no arrays, `null` instead of `undefined`.
- `withRedisLock` is fail-fast (409 on contention) — a double click gets a conflict instead of queueing behind itself.
- ESLint `id-length` minimum 2 and one class per file named `<name>.<role>.ts` — readability rule for a team.
- Backup codes left come from `GET /auth/2fa/totp/scratch-codes` (`{ remaining }`), not a `/me` field — counting needs decryption, and a stored count could drift from the set.
- 429 from `RateLimitService.reserve` sends `Retry-After` from the longest TTL among the over-limit keys — clients can back off without guessing, and under-limit keys never extend the wait.

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
- One rule set, `ProblemAccess`, for list and detail; the legacy quirk that admins do not see private problems in lists is dropped for a `visibility` filter — one source of truth.
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
- Languages admin has no delete and no key rename — judges report languages by key and submissions, problems and judges reference them; a rename or delete would orphan them.

## Judging and bridge

- Judge protocol is the DMOJ protocol of the qhhoj judge-server fork, with submission ids as UUID strings — the fork must not treat ids as ints.
- Mongo is the queue truth (`QU` plus `priority`); the bridge claims QU -> P before sending and the in-memory queue is rebuilt on start — a bridge restart loses nothing and never ends in IE.
- API -> bridge commands go over a Redis stream, fire-and-forget; a lost `judge` command waits for the bridge's resync — no RPC coupling, Mongo is the backstop.
- Every packet's write filters `{_id, judgedOn, status}` — stale or duplicate packets are no-ops.
- Packets for a submission the judge is not working on are ignored, and grading packets before `grading-begin` are ignored — a judge that kept grading across a bridge restart must not poison the next submission; only a wrong `submission-acknowledged` is IE plus close.
- Pre-handshake packets are capped (4 MiB compressed, 8 MiB inflated), anything but `handshake` closes, JSON depth is limited, and unauthenticated sockets are capped per address — unauthenticated memory and CPU stay bounded. The bridge port is reachable only from judge hosts.
- Flood cap is 1000 packets/s and the idle clock pauses while a packet is handled — batch traffic from a real judge must not trip it.
- Case text is clipped by UTF-8 bytes (512, feedback 50) at a code-point boundary and cases are capped at 10000 — a submission document stays well under Mongo's 16 MB.
- File-only languages (B17) follow legacy: the upload is saved under `MEDIA_ROOT/submission_file/<code>/<userId>/<random>.<ext>`, the source is its media URL, `fileSizeLimit` is MB, and the bridge sends `file-only`/`file-size-limit` and makes the URL absolute with `SITE_URL` — no judge-fork change. Legacy rows hold `/submission_file/...`, which v2 does not serve: they judge once the migrator rewrites them to `${MEDIA_URL}/submission_file/...` and copies the files under `MEDIA_ROOT/submission_file/` (migrator work, not done yet).
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
- Bulk rejudge `dryRun` counts with the same filter and never throws for the lot limit (`allowed` tells the UI), so the confirm dialog can show the number first.
- Submission detail action flags come from the same pure rules the action endpoints enforce (`submissionActions`), so the UI cannot drift from the 403/409s.
- Submission `lockedAfter` is returned to editors only — the lock time is moderation information; an owner sees the lock as `canRejudge: false`.

## Effects and realtime

- Effects recompute from Mongo and `$set`, never increment; `runCoalesced` serialises one key across processes, extends its lock while running and reruns for marks left meanwhile — duplicate and retried jobs are harmless, bursts collapse.
- A sweep every 10 min recomputes users and problems with recently judged submissions, with a watermark set only after success (at most 24 h back) and a 10 min overlap — recovers lost `submission-graded` jobs.
- `submission-graded` is enqueued through `notifyGraded` with a 1 s bound, errors logged — a Redis outage must not block grading or the API; the sweep repairs the gap.
- Effects, sweep and rescore processors start only after the submission indexes exist (`startAfterIndexes`) — hinted queries throw before the index is built.
- User points: best per problem over public non-org-private problems, PP = sum of 0.98514^rank * points over the first 300 plus 0.05 per solved — legacy `calculate_points`; solved is AC with `casePoints >= caseTotal`.
- Problem stats exclude unlisted users; an AC counts only when `points >= problem.points` — legacy `update_stats`.
- Org PP and member counts are recomputed by the `organization-points` job (coalesced per organization), queued by membership changes and by user-points recomputes that move a member's PP — one writer, like user points.
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
- A current contest feeds `ProblemAccess`: before the start every problem is hidden, after it the contest's problems are visible whatever their own publicity; the editorial is 404 while in a contest — legacy parity.
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
- Freeze applies to `icpc` and `vnoj` only, stays after the end (editors set `frozenLastMinutes` to 0 to unfreeze), and non-editors only ever see `frozen*` fields, in participations, which once leaked live standings.
- Hidden scoreboards list no scores to non-editors in participations — stricter than legacy, consistent with the freeze stance.
- Disqualify sets score -9999, bans the user from the contest, clears the current pointer, queues a rescore and re-rates when ratings exist; auto-ban after N disqualifications is off by default (setting `contest.banAfterDisqualifications`, 0 = off), lifts by compare-and-set on the ban reason, reconciled from the final `isDisqualified` — concurrent opposite requests converge and a manual ban is never lifted.
- Rating is Elo-MMR ported line for line (goldens generated from the legacy Python), queued by an editor or by the rescore of a contest that has ratings, one job at a time; it deletes and re-rates from the earliest affected end time in one Mongo transaction — a re-rate after any contest edit keeps later contests consistent.
- `contest-rescore` of a contest that has ratings enqueues `contest-rating` — the single trigger after disqualifications and scoring or end-time edits (broader than legacy); an end-time edit queues no rating itself, and the rating run's start moves earlier until it covers contests whose end moved.
- Rating is never computed from a frozen board: `POST /rate` answers 409 while the contest is frozen, the worker skips a target frozen at run time (logged) and leaves every contest still frozen at run time out of the re-rate chain (a contest is rateable once its board is unfrozen, like the `now` bound), and ratings follow live standings, which would reveal the hidden winner.
- A rated contest frozen again after rating loses its ratings on the next re-rate run covering its end; it is re-rated only by `POST /rate` after unfreezing — an automatic trigger cannot tell "never rated" from "deleted by a chain run" and would make manual rating automatic.
- Contest data download: zip written to a per-run temp name, sources fetched lazily, capped in bytes and entries, prepared at most once per 24 h unless the zip is missing; the root is outside `MEDIA_ROOT` — the zip is served by the API, never directly.
- Public ranking links use 18-char tokens with per-IP miss limits; both links and ranking codes serve the same `board` — frozen while frozen.
- Official ranking CSV is parsed at write with fixed size, row and column caps; the body limit is raised only on that route (and the problem data upload route).
- Announcements are rendered at save and pushed as ids over Redis `contest-events` and the shared SSE hub — one streaming stack for submissions and contests.
- Clarifications dropped (no rows in production).
- List rows carry the viewer's live status and current contest from one participation read per page (`$in` on the unique `{contest, user, virtual}` index) plus the pointer — no read per row.
- The detail shows the viewer's own cells frozen during a freeze, exactly as their ranking row — one freeze rule; attempts and pending flags read statuses only, never results.
- Solver counts are the ranking's `acceptedCount` rule from one aggregate over live rows, cached 30 s per frozen view and purged with the ranking keys, null unless the full board is visible — the detail must not rebuild the whole board per view or leak a hidden board.
- Register, join and leave refusals have one code each (legacy's distinct messages) with unchanged statuses — the SPA maps codes, never messages.
- No unregister — legacy has none (`ContestLeave` only clears the current contest); YAGNI.
- Announcements get no author and no server read state — neither the schema nor legacy has an author; ids are time-ordered, so the SPA keeps the last seen id.
- Contest settings echo `pushAnnouncements`, `hasRankingAccessCode`, per-problem output prefixes and a `users` lookup (ids stay, wire fields never change); `requiresRankingAccessCode` mirrors `requiresAccessCode`; the ranking code itself is never returned, only the boolean.
- Contest action status scans live queue jobs (no per-contest job id by design); there is no failed state because jobs are removed when they end.

## Organizations and users

- Membership stays `users.organizations` (ordered array, no membership collection) — legacy has no role or join date; the principal already carries it.
- Planned (migrator deferred): migrated `about` (users and organizations) must be rendered into `aboutHtml` on backfill, and `organizations.memberCount`/`performancePoints` recomputed — reads never render and the job writes the counts.
- Unlisted organizations are kept out of every enumeration but stay reachable by slug — legacy leaked them through select2 and the sitemap; a private unlisted organization is joined through its link.
- Joins and profile reorders are compare-and-set on the membership array; approvals run under a per-organization Redis lock against a live member count — parallel requests cannot pass the open-organization cap or `slots`.
- A personal look (accent preset, glass, glow) is one nullable `appearance` object on the user, replaced whole by PATCH /profile and cleared by null — the SPA sends the whole look, null means "use the site's"; the colour mode stays in `siteTheme`.
- Accent presets are a closed enum (`APPEARANCE_ACCENTS`), not free colours — the SPA checks contrast per preset, a free colour cannot be checked.
- Profile edit can only reorder or leave organizations — legacy let users self-join private organizations through the profile form.
- `edit_all_organization` decides join requests and `spam_organization` lifts the admin cap — legacy ignored the first and its permission typo made the second superuser-only.
- `about` renders in a `user` style that escapes raw HTML — legacy `safe_mode = 'escape'`.
- PATCH bodies refuse `null` outside a per-DTO allowlist (`RefuseNullFieldsPipe`) — `null` used to be stored or crash.
- Org-points enqueues coalesce through a Redis NX pending flag per organization — a burst of joins costs one recompute.
- A failed org-points enqueue is logged and lost until the next membership or PP change — a Redis outage must not fail the write, like `submission-graded` but without a sweep.
- Hinted organization member and submission reads need their indexes built before serving — `.hint()` throws on a missing index, so deploy runs `autoIndex` or `syncIndexes` first; leaderboards rely on the index the planner picks, with no `.hint()`.
- Leaderboard ranks follow the sorted field and continue across pages — legacy keyed every board on PP and restarted at the page offset.
- PP breakdown is its own paged route (the spec had one `/solved`) — it is cached per user for 600 s, so a problem that just turned private can show up to 600 s.
- The heatmap uses the viewer's zone like legacy; the spec's "user's timezone" reads as the viewer — and buckets days with Mongo's time-zone support, where legacy used `utcoffset().seconds`, wrong for negative offsets.
- Muted users may edit profile settings except `about` — muting silences public text, not account settings.
- `firstName` is editable (<= 30) and blocked in official-contest mode — legacy parity with `about`.
- A ban cannot use the automatic cheating reason — that reason is reserved for automatic contest-cheating bans.
- Join requests are limited (5 per hour per user) — legacy had no limit.
- User data zips live 7 days outside `MEDIA_ROOT` (and apart from `CONTEST_DATA_ROOT`), at most 3 prepares per user per day, served by the api — legacy kept them forever in a cache directory.
- New organization admins join the `Org Admin` group on update as well as create — legacy granted it on create only; it is never revoked, like legacy.
- One rule, `ContestAccess.boardReadable`, decides whether a viewer may read results derived from a board; the user's ratings page uses it. An unreadable board keeps its history entry with null rank, performance and rating, and the rating summary (min, max, count) counts readable entries only.
- Organization summaries carry `isOpen`; home users carry the first listed organization through `OrganizationsService.firstListedByUser`, shared with the leaderboard — one rule, so the two lists cannot disagree.
- Staff user list uses a CI-collated username range (an `i` regex cannot use the index) and a partial `banReason` index; ban duration is deferred because it needs an expiry sweep.
- A searched staff user list is ordered by username along the same CI index (no in-memory sort), `page` is capped at 500 to bound the skip cost, and `banned=false` means not banned (no `banReason`).

## Blog and comments

- Comment pages store the entity id with a type (`problem`, `editorial`, `contest`, `blog`, `tagProblem`); the API takes natural keys — a problem rename never orphans a thread.
- One `CommentPagesService` decides page access by reusing `ProblemAccess` (with the contest scope), the editorial rule, `ContestAccess` and `BlogAccess` — comments, votes, recent comments, feeds and the user tab cannot drift from the pages they belong to.
- A problem of the viewer's started contest shows no thread and takes no comment, like legacy's clarifications area; a plain `commentLocks` lock keeps the thread readable — an open thread would leak hints during the contest.
- Threads: roots newest first, replies in `path` order, depth <= 100, all replies of a page of roots loaded — legacy MPTT put siblings newest first and had no cap; the 10-comments-per-5-minutes limit bounds growth.
- Subtree hide and unhide filter with an `$or` of equality and a prefix regex — a single `^path(/|$)` regex has no index bounds and scans the whole `path` index.
- Comment-thread reads `.hint()` `{threadId, hidden, path}` — the indexes must be built before serving.
- Comments record `hiddenBy` (the comment whose hide hid them, itself for a direct hide); unhide clears only the rows that comment hid, so a reply hidden on its own stays hidden when an ancestor is unhidden. Legacy hidden comments migrate with `hiddenBy` = own id.
- Unhiding under a hidden parent is 409 — otherwise a visible orphan shows in lists, counts and points.
- Votes are changeable and withdrawable; the vote row and the target's score change in one transaction, and a vanished target aborts it — legacy allowed one vote ever, and parallel votes must not lose a point.
- Contribution points are recomputed by a job coalesced per user on every trigger, never incremented — the spec's "incremental on votes" would drift against a concurrent recompute.
- Locks are managed by `judge.change_comment` — legacy had only the Django admin.
- Org-private and unpublished posts never reach feeds, the homepage, other users' tabs or outsider votes; feeds are a signed-out viewer's view — legacy leaked them through the feed, the sitemap and `vote_blog`.
- Posts render in the new `blog` style, comments in `user` — legacy `blog` was a sanitized staff style and `comment` safe mode; posts are strangers' HTML, so `solution` is not safe enough.
- `blog` sanitizes author HTML first and splices KaTeX in afterwards through nonce slots — KaTeX output carries inline styles the sanitizer must otherwise allow, which would let authors forge overlays.
- `blog` author CSS is strict (no `position`, offsets, `transform`, `z-index`, `opacity`, negative margins or viewport units; unit allow-list; `user-` class prefix; no author MathML or SVG; iframes only YouTube/Vimeo, sandboxed) — a post must not cover the page.
- The frontend must contain every user-authored HTML container (`overflow: clip; contain: paint; isolation: isolate; min-width: 0; contain: inline-size`, `.katex-display { overflow-x: auto }`) — in-flow overflow cannot be stopped by the sanitizer; this covers posts, comments, profile and organization `about` and ticket messages.
- User-authored KaTeX (`blog`, `user`): `maxExpand` 50, `maxSize` 50, sizes beyond ±50em refused on the parse tree, parametered macros refused (hex colours allowed only after colour commands), 20k parse-node cap, 500 ms of KaTeX per render in total (the first formula past it is a `math-error`, later ones show as source) — a stranger's `\def` chain cost seconds per formula; worst accepted formula is about 350 ms.
- `katex` is pinned to exactly 0.19.0 — the size and node checks call the internal `katex.__parse`.
- `font-size` multipliers scale after the size check — accepted, container containment covers the overflow.
- Muted users cannot write or edit posts; staff do not bypass the 10-solve gate — muting silences public text; legacy let superusers only bypass.
- `publishOn` may be set on create (default now) — legacy overwrote it, which made scheduling impossible; a scheduled post is announced on Discord only once published.
- Deleting a post deletes its votes, comments and lock — legacy orphaned the comments; a comment created during the delete may survive unreadable (its page is 404).
- Blog writes are limited to 10 per hour per user, comments to 10 per 5 minutes, votes to 60 per minute across posts and comments — legacy had no limits; moderators share the blog budget.
- Official-contest mode closes comment pages, posting, editing, comment votes and blog writing for non-superusers (moderation routes refuse before writing); blog reads and votes stay, and post delete is not locked (intentional, legacy parity) — legacy hid the comment area and the editor.
- Recent comments scan at most 10 batches of 2 x the page size with one contest scope and continue by id — bounded work even when most recent comments sit on unreadable pages; the anonymous slice is cached 60 s.
- Homepage contests come from `GET /contests?phase=`, not `/home` — one source for contest lists.
- Feeds (blog, comments, problems) carry 25 items, cached 5 minutes, chronological — legacy fed every post with sticky ones first.
- The data export keeps hidden own comments (legacy) and adds own and co-authored posts, streamed — a large history must not sit in memory.
- The `discord.webhooks` setting maps legacy event names (`default`, `on_new_comment`, ...) to https URLs (http for localhost outside production); the URL is read from the setting by the worker, never in job data or logs; payloads allow no mentions, a 4xx is not retried and redirects are refused — a bad URL must not retry-storm or leak the token.
- Discord announcements: comments only for pages a signed-out viewer can read, posts only when published and personal — the channel may be public; organization and suggested problems announce their name and a statement excerpt on create (spec, legacy content); a problem's announcer is its creator — in suggest mode the suggester, otherwise a curator, where legacy used `suggester or authors.first()`.
- `CommentResponse.canEdit` is true for a muted author whose edit is then 403 — muting is rare and the viewer's document is not read per page.
- Accepted residuals: unhide's parent check is read-then-write (a racing hide can leave an orphan), and hide/unhide of a subtree is not one atomic step.
- Planned (migrator deferred): comments map legacy `p:`/`s:`/`c:`/`b:`/`t:` pages to entity ids, build `path`/`threadId` from MPTT and render `bodyHtml`; posts render `contentHtml`/`summaryHtml`; `users.contributionPoints` are recomputed after the backfill — reads never render and one job writes the points.
- `judge.change_settings` is operator-grade (grant it to superusers only): webhook and pwned URLs are admin-set, so in production they must be https and may not be `localhost` or a literal loopback/private/link-local IP, and the pwned fetch refuses redirects; the accepted residual is a hostname that resolves to an internal address (blind SSRF, an operator could already reach it).
- Registration takes one optional `organizationId` (open and listed only, never private or unlisted) and `languageId`; legacy allowed several open organizations without the unlisted filter — a signup must not reach hidden schools, more are joined afterwards through the usual membership caps. `activate/resend` always answers 204 and is limited per IP and per email so it cannot enumerate accounts or flood mailboxes.
- Comment `body` is returned only with `canEdit`, so the edit form never needs a second request and readers never get sources.

## Tickets and site content

- Ticket messages are limited to 30 per 10 minutes per user (and tickets to 5): legacy had no limit and each message fans out to SSE and Discord.
- Ticket notes are visible to everyone who can read the ticket (legacy parity) and editable only by assignees and `change_ticket` holders.
- Activity session keys are `sha256` hashes (anonymous visitors: hash of address and agent) so a log or dump never holds a usable session id.
- The user agent is classified by a small in-house function (desktop, mobile, tablet, bot): coarse is enough for the staff view and it avoids a dependency.
- Legacy `userActivity` and `userSessions` are not migrated: they are unbounded and v2 expires them after 90 days; `users.lastAccess` and `users.ip` come from the profile.
- Misc config is served publicly through `GET /site` (legacy parity), so it must never hold secrets.
- Flatpages render in the `blog` style, the sanitised staff-HTML style, not `solution`: staff pages stay contained like posts.
- Flatpage urls match `^[-\p{L}\p{N}_/.~]+$` (Django's Unicode `\w`, so Vietnamese slugs round-trip): no query, fragment, dot segment ambiguity or encoded tricks reach another page.
- `judge.change_miscconfig` is operator-grade: the analytics snippet and announcement are raw staff HTML served to every visitor, so grant it like `judge.change_settings` (superusers only).
- Planned (migrator deferred): tickets map `content_type` to `linkedItem.type`, inline `general_issue.issue_url` into `generalIssues`, embed messages ordered by time (more than 500 imported whole and reported), copy assignees and `is_contributive`, render bodies in the `user` style, and stamp v7 ids with the legacy creation time so `_id` order stays newest-first; flatpages copy `registration_required`, strip the trailing slash from `url` and render `content` with the `blog` style (legacy urls with non-ASCII characters are accepted by the admin charset); navigation items copy `order`, `parent_id` and `hidden`, and each `regex` is checked with `new RegExp` (legacy Python `re.VERBOSE` patterns need whitespace and comments stripped, or are reported); misc config keeps the last row per key (`home_page_top` and `top_notification` are Django templates rendered by `render_django`: convert or report them); after the backfill run `syncIndexes` before serving, then recompute contribution points so good tickets count.
- Ticket `open` filters both ways; absent means both — the closed-ticket view needs `open=false` and the default list must not change.
- Flatpage preview is its own route (`flatpages.change_flatpage`) rather than loosening the problems preview, which needs `edit_own_problem`; it shares the `render-preview:user:<id>` budget with the statement preview, so one per-user limit covers both.
- Flatpage revisions answer 400 for a malformed page id, but the existing `/pages/:id` routes keep 404 — the ruling kept the older routes unchanged rather than align them.

## Settings

- Non-infrastructure env became admin settings in one typed registry (`libs/settings/src/registry.ts`), edited at `/api/internal/admin/settings` — operators change SMTP, social login, webhooks and limits without a redeploy; env keeps infrastructure and key material.
- Secrets are sealed with `ENCRYPTION_KEY`: `secret: true` encrypts the whole value, `secret: ['clientSecret']` those top-level fields; the AES-GCM helper moved to `libs/common` — `libs/auth` reads settings and sits above `libs/settings`, so the helper cannot stay in `libs/auth` (no lib cycle).
- `SettingsService.get` is synchronous over an in-memory snapshot (change stream plus one-minute resync, like every querier); `set` runs in one Mongo transaction (read, combine, validate, seal, upsert, revision) and updates the writer's snapshot at once — parallel patches of one setting cannot lose a field and a hot path pays no query.
- PATCH merges fixed-shape object settings (`auth.*`) and replaces maps and scalars; `null` is refused (`RefuseNullFieldsPipe`), clear with `{}`, `''` or `enabled: false` — an admin who cannot see a stored secret can still change the other fields.
- Admin `GET` returns secrets as `{ set: true }`, revisions (`settingRevisions`: before, after redacted, `changedFields`, actor) never hold a clear secret, and a validation error never echoes the input — a secret leaves the server in no response, row or log.
- An unreadable stored value (corrupt row, rotated `ENCRYPTION_KEY`, key dropped from the registry) falls back to the default with a key-only warning — one bad row must not take the process down.
- There is no env fallback and first boot runs on registry defaults; importing old env values is a migrator step (paused) — two sources for one value would disagree silently.
- `mail.smtpUrl` defaults to `''`: mail is not configured and sends fail as 503 `mail_unavailable`; the mailer keys its transport by the URL and closes the old one, OAuth providers are built per call from the settings — a change applies at once, a disabled provider 404s at `start` and `callback` straight away.
- A social signup started before its provider is disabled may still complete within its 10-minute window — accepted: the state and the pending cookies already bound it to that browser.
- `auth.pwnedApiUrl` `''` turns the breach check off, a failing check fails open as before; the test harness switches it off — no network in tests.
- `site.timeZone` (default `Asia/Ho_Chi_Minh`, an IANA name) is a setting and the time-zone helpers live in `libs/common` — the settings validator needs them below `libs/settings`.
- `AppError` carries `extra` members beside `code` and `message` (`banReason` on a banned login, B8) — the SPA never parses a message.
- Validation failures add `issues: [{ field, code, message }]` next to `fields` (B10): codes are the constraint name in snake_case, a decorator `context: { code }` or a code a service names (`username_taken`) — `fields` stays for old clients and the SPA maps codes to its own texts.
- Submit refusals have their own codes (B9): `banned_from_problem`, `contest_submission_limit`, `unfinished_submission_limit` (429), and `solve_first` / `contest_running` / `hidden` on submission detail and source (B18); an `if-solved` problem in a contest whose list is closed answers `contest_running` (including an ended contest with a hidden scoreboard), because solving would not help.
- `GET /auth/username-available` (B11) shows what registration's "Username is taken." already shows, 30 per 10 minutes per IP; a stale pending signup reads as available because registration reclaims it.
- Resend (B16): pending = inactive, not banned, never logged in; sends in the background and answers 204 alike for unknown, active and pending emails, limited per IP and per email — no enumeration, no mailbox flooding. A pending account older than 7 days can still be reclaimed by a later registration of the same name.
- The session carries `siteTheme`, `appearance`, `languageId` (B2) and, before the second factor, `twoFactor: { username, methods }` (B14) with `user` null — the SPA draws the second-factor page without learning more. `siteTheme` defaults to `auto` and is checked by shape only, theme ids belong to the SPA (B3).
- Leaderboards carry `rating` and the first listed `organization` (B5), problems filter on `solved` (B6), the homepage `counts.contests` counts what an anonymous visitor sees (B15).
- The problem detail names the viewer's current contest and attempts left (B19), the submission detail carries `totalCases` counted from the problem's `C` rows, null when case results are hidden (B21).
- `GET /problems/:code/pdf` answers 202 `{ status: 'rendering' }` with `Retry-After: 3` and `no-store` while it renders and 200 `application/pdf` on the same URL afterwards (B20); only enqueueing spends the per-IP render budget, so polling is free — the button polls one URL instead of a wait page.
- `npm run seed:e2e` is an api-side script (`apps/api/src/seed/`) that upserts by natural key and refuses unless `NODE_ENV` is `test` or `development` (B23); the e2e problem is `e2e_sum` (the code `e2e-sum` fails the code pattern) — real-backend frontend tests need known users and a problem without a hand-built database.
- Submission stats (B24) count only what a signed-out viewer may see, with hinted count queries so yesterday's rows are never read — a public counter must not leak private or frozen rows.
- Not done: B4 (a `ranking` event on `contest-events`) and B22 (structured samples, tied to the problem-editor work); B7 (weekly top board) dropped — legacy had none (`judge/views/blog.py` shows top PP and top contributors only), the SPA already shows "Top rating" from the leaderboard, and a weekly figure needs a new per-submission aggregation with no legacy parity.
- Settings restore patches the revision's `before` minus sealed fields; whole-secret keys answer 409 because revisions never hold secrets, and the current secret is kept.
- Setting `default` is redacted like the value, so a secret default never leaks through `GET`.

## Similarity

- Dolos (`@dodona/dolos-lib` 3.5.1, MIT) instead of MOSS — no external service or key, code stays on our servers, same winnowing family.
- Engine in a child process — the library is ESM-only with native tree-sitter addons (Jest and the CJS build cannot load it); the parent kills the child on the deadline and on worker shutdown.
- V8 heap cap of 2 GiB on the child, not a hard cap — native parser memory is outside the V8 heap and bounded only by the container; the 30 minute deadline and the cap are constants, not settings (revisit with real data).
- The child resolves `dolos-lib` itself — no dependency on the worker's working directory.
- `getPair` on candidate pairs, never `allPairs()` — `allPairs` builds all N x N pair objects (800 identical files: 17 s and 310 MB against 2.7 s and 160 MB); candidates are files sharing a fingerprint with a different owner.
- Same-user pairs never built or stored — the spec forbids them and it shrinks the work for resubmitters.
- C and C++ are one family (C++ grammar) — C is close to a C++ subset, so C pasted as C++ is caught; other cross-language copies stay out of scope.
- Pascal compared as text — Dolos has no Pascal grammar and the site uses Pascal; weaker on renamed identifiers; Kotlin, Haskell, Ruby, Perl, Lua, Fortran, Assembly and the non-code languages are skipped and listed in `unsupported`.
- CE, IE, AB, RJ and unjudged submissions are excluded — sources that never ran or were rejected carry no signal; a copied wrong solution is still a copy, so WA, TLE, MLE, RTE, AC and partials are compared.
- Newest 3000 submissions per problem and family — bounds memory and time (3000 identical files is 4.5 million pairs).
- Limits as admin settings snapshotted into the run — operators tune them without a deploy and a run shows what applied; `maxPairs` caps a run, not a group; 50 fragments per pair cap the output.
- A failing group is skipped and flagged `failed: true` — one bad group must not lose the others' results.
- One active run per scope by a partial unique index — two racing starts cannot create two runs; an abandoned run never overwrites results.
- Stale release at the next start: a run queued 3 hours (by `createdAt`) or running past the 30 minute deadline plus 10 minutes (by `startedAt`) is abandoned — queue wait alone no longer discards a run that is legitimately running.
- A success deletes the earlier runs and pairs in one transaction, a failed run keeps them — staff never see a half-written set.
- A stalled redelivery fails the run, and a worker shutdown mid-run fails it (`internal_error`) keeping earlier results — the scope is freed at once; cost: one manual re-run after a deploy.
- Rate limit of 10 starts per user per hour, given back on 409 or an enqueue failure — a refused start costs nothing.
- Unknown, not-visible or not-editable scope is 404, missing permission 403 — nothing tells staff which problems or contests exist; legacy answered 403 to a visible, non-editable contest.
- Pair sources follow the normal submission source rules per side and the list omits problems the viewer cannot see — one source of truth for source secrecy (`SubmissionsService.viewable`), including the contest anti-cheat block.
- Pair list problem-only and language-only filters (and a contest viewer's visible-problems narrowing) read through the `{run, similarity, _id}` index and filter after, bounded by the run's `maxPairs`; only no filter and problem + language are served page-for-page.
- `judge.moss_contest` codename kept — migrated groups already carry it.
- Legacy `judge_contestmoss` rows and the `contestMoss` collection are not migrated (migrator: no mapper) and the old rows stay in the database unreachable — the result URLs on Stanford's server have expired.
- Worker image and CI need `python3`, `make` and `g++` (tree-sitter grammars compile at `npm ci`); the worker runs one similarity job at a time.

## Deploy

- Worker image needs pandoc >= 3, util-linux `prlimit` and Chromium; plan about 2 GB of memory per job of concurrency — PDF and Polygon conversions are memory hungry.
- API and worker mount the same `MEDIA_ROOT`, `PROBLEM_DATA_ROOT`, `PDF_CACHE_ROOT`, `CONTEST_DATA_ROOT` and `USER_DATA_ROOT`; `PROBLEM_DATA_ROOT` and `PDF_CACHE_ROOT` are not checked against `MEDIA_ROOT` at boot, only `CONTEST_DATA_ROOT` and `USER_DATA_ROOT` are; none of the four data roots may sit under it, and `USER_DATA_ROOT` and `CONTEST_DATA_ROOT` must not overlap — it is served publicly.
- nginx: `proxy_buffering off` and a long `proxy_read_timeout` on `/api/internal/events/`; set `TRUST_PROXY` to nginx's address — streams need it, per-IP limits are meaningless otherwise.
- SSE per-IP cap stays 16; `SSE_IP_ALLOWLIST` (IPs/CIDRs) gets 512 for school labs behind one NAT — a blanket raise would let one machine hold hundreds of streams.
- Production: systemd units (api, bridge, worker under `qhhoj.target`) behind host nginx (`deploy/`), not Compose — no Dockerfile, nginx reads dist and `MEDIA_ROOT` from disk, Chromium/pandoc/`prlimit` are simpler on the host; one bridge instance; all sessions are invalidated once at cutover.
- pandoc comes from the official static release (pinned, sha256-checked in CI), not apt: the Debian/Ubuntu build dies with "failed to create OS thread" under `prlimit --as=768MiB` while the static one runs down to 192 MiB; `assertAvailable` reports a start failure verbatim and says "not installed" only for a missing binary.
- Submission stats are cached 30 s in Redis under a zone-agnostic key (`submissions:stats`), so a `site.timeZone` change or the midnight rollover can lag up to 30 s.
- OpenAPI response schemas come from the swagger CLI plugin (`*.dto.ts`/`*.response.ts`), wrapped in `{ data }` by `envelopeResponses`; plain jest cannot run the plugin (and needs isolatedModules off), so `npm run test:openapi` has its own config and the main suite ignores `openapi.e2e-spec.ts`. A new JSON route without a response class fails that spec.
- Ticket lists look up the editable problems' ids (`visibleIds`, also for `edit_all_problem`) and filter on `linkedItem.id`: index-backed, and a ticket of a deleted problem stays unreadable exactly as `canSee`. Cost: one `distinct` of up to every public problem id per list for `edit_public_problem` holders; denormalize a `problemPublic` flag on the ticket if it gets slow. An unfiltered staff list counts from metadata (`estimatedDocumentCount`), as `countDocuments({})` scans.
- A staff `GET /problems/:code/tickets` on a private problem is 404 (legacy `get_problem_or_404` parity); staff use `GET /tickets`.
- Tickets: filing and posting need only "not muted" (`TicketGateService`); anyone who `canSee` a ticket may post, closed or not. The 500-message cap sits in the `$push` filter (409 `conflict`), creation 5 and messages 30 per 10 min per user (429 `rate_limited`, hit released on a refused write). Events carry ids only; Discord `on_new_ticket*` fire for every ticket.
- Ticket streams judge every event with the viewer's current access (fresh ticket + problem read); a removed permission, ban or session end takes effect at the next stream recheck (<= 60 s by default), like the other channels. Frames are ids only. Events beyond the per-process backlog (`ticketBacklog`) are dropped, then one `resync` frame tells clients to refetch.
- `GET /site` (navigation + misc config) is public and `Cache-Control: private, max-age=60`: the auth guard can set a refreshed session cookie on any request, so a shared cache must never store it. Misc config is served to everyone: never store secrets there. Flatpages are served from the stored `contentHtml`; `registrationRequired` pages answer 401 to anonymous readers, unknown or odd urls 404.
- User activity is captured by a Fastify `onResponse` hook (registered in `UserActivityCaptureService.onModuleInit`, no awaits) into a 5000-row buffer (oldest dropped and counted past it), flushed at 200 rows or every 2 s and on shutdown; a failed or hung (10 s) flush drops its batch, never a response. Paths are stored query-stripped with credential routes (`/public-rankings/<token>`, `/reset-password/<token>`, `/activate/<key>`, also in referers) redacted via `CREDENTIAL_ROUTES` in `libs/community/src/user-activity.ts`, `/site` and `/auth/me` are not logged, an impersonated request is logged as the impersonator (the target's `lastAccess`/`ip` stay untouched), and `users.lastAccess`/`ip` are written at most every 5 min per user (`user-access:<id>` SET NX EX). Live sets `active:*` hold the last 30 min, at most 50,000 members each.
- Staff activity logs sort by `{at:-1}` only (no `_id` tie-break): every filter is then an index scan with no blocking sort, at the cost of rows sharing a millisecond possibly repeating across a page boundary. Lists return `hasMore` without a total (`HasMorePageMetaResponse`). The CSV export streams a cursor in 1000-row chunks, at most 100,000 rows, fixed filename, `no-store`. Deletes are by one user or the anonymous set only, never by free filter, and log who, whom and counts.
- Staff edit flatpages, the navigation bar and misc config through `api/internal/admin/site/*` (legacy Django permission names, so migrated groups keep them). Flatpage Markdown is rendered in the sanitised `blog` style (admins cannot embed raw HTML, foreign iframes or fixed overlays; widen later); urls match the Unicode legacy charset `[-\p{L}\p{N}_/.~]`, every page write is a `revisions` row, last write wins. Deleting a navigation entry with children is 409 (legacy cascaded); `path` is a site path or http(s) URL and `regex` must compile because both reach every visitor's SPA shell. Queriers apply `delete` change events so other processes drop a deleted row at once; the writing process resyncs after each write. Flatpage reads are `Cache-Control: private, no-cache` (the body depends on the session).
- Querier snapshot loads (`loadAll`: whole-collection `find` of a tiny registry) carry the comment `SNAPSHOT_LOAD_COMMENT`, and `profileQueries` drops exactly those entries: the resync crons (settings every minute, catalogs and groups every 10) fire on the wall clock and would otherwise fail index tests by chance.

## Readability

- Lint errors at `complexity` 15, `max-lines-per-function` 80 (blank lines and comments skipped) and more than 4 parameters — the refactor cleared every hit, so new code cannot regress; the targets are 10 and 40.
- Parameters are capped by a `no-restricted-syntax` selector, not core `max-params` — that rule cannot exempt Nest DI constructors or route handlers whose parameters are all decorators, which are framework-shaped.
- Specs and the spec harness under `apps/*/test/` skip the length rule only — they read as tables of cases; complexity and parameters still apply to them.
- `parseBridgeCommand` and `renderMath` keep their complexity behind an inline disable — one protocol switch and one guarded KaTeX call read best whole.
- `contestMetaOf` stays in the bridge — the api and worker read different contest fields for different jobs; only `runPretestsOnly && isPretested` recurs, and a one-line expression is not worth a shared helper.
- One name per concept, listed in CONTRIBUTING's glossary; renames happen only where a term was ambiguous (`AllowBeforeTwoFactor` for the 2FA-pending session, since `partial` means partial scoring), and wire fields never change — the SPA depends on them.
- `libs/<lib>/src/testing.ts` stays one test-support entry per lib, refused in production code by lint — splitting the small files would add paths without adding clarity.
- The personal data export (request and download) is `@NoImpersonation()` — an admin impersonating a user must not request or download that user's private export; `PATCH /profile` stays allowed.
- Blog moderation (visible-only patch by edit_all_post) skips the personal write limit and the official-contest lock — moderators must hide spam during contests.
