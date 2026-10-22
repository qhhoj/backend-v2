# qhhoj-backend

## 2.34.10

### Patch Changes

- 7ba5a77: Polygon interactive problems with "treat points from checker as percent" read the interactor's points as a percentage (`interactive.treat_checker_points_as_percentage`, routed only to judges that advertise feature `interactive.percentage`); an import with rescaled fractional points is refused for an interactor without the flag.

## 2.34.9

### Patch Changes

- 3f188c1: A judge's Final RETRY for a run the user already aborted ends the submission as AB instead of requeuing it for another judge.
- 822b6ca: Contest event streams treat a session short of its 2FA or password gate as anonymous. Activation resend and activation skip accounts deactivated by staff.
- f9b4654: Grading no longer rounds a near-miss case sum (9.96 of 10) up to full marks: case points stay a tenth below the total unless every point was earned, and a non-partial problem gives full points only when the cases earned their whole total.
- 9240157: The contest export names a problem taken out of the contest by its code, in `submissions.csv` and in `sources/<code>/`, instead of `problem`.
- 39c6c60: Problem create, suggest and clone refuse a code whose test data directory already exists (400 `data_directory_taken`). A Polygon import takes the data lock before its commit, waiting up to 60 s for an API data write, so a committed import no longer leaves its files unwritten.
- 8aa2a13: External judge: poll once more before timing a run out; refuse `.`/`..` remote ids; clear the API token when the base URL changes origin.
- 7c1af90: A zip or Polygon-link import that changes a problem's `authors` or `curators` needs `judge.edit_all_problem`, as the editor does: an update may only repeat the stored lists, a create may name only the requester as curator and no author. Otherwise 403 `forbidden`, before the package is stored.
- 97ed59d: ioi16 credits each case outside batches on its own instead of pooling them under one minimum, and rounds a cell to 3 decimals so a full cell counts as solved. A 0-point contest problem has no solvers, first solve or balloons.
- 4bdf1de: PUT and uploads refuse what judge-v2 refuses: a generator (upload or stored), an output limit above 64 MiB, and case files in dot folders; a delete is never refused, so a stored generator can always be removed; uploads can no longer take, and deletes no longer remove, a Polygon helper header.
- 8be538f: Every UUID body, query and path field is lowercased before use, so an uppercase id acts exactly like the lowercase one. Fixes: moving a problem into an organization named by an uppercase id skipped its storage limit and its code prefix; kicking a co-admin named by an uppercase id removed them instead of answering 409 `admin_not_kickable`.
- c4adb89: In-memory queriers (groups, settings, catalogs) re-apply the change-stream events handled while a resync was loading, so a permission revoke, setting change or catalog delete made during the load is no longer undone by the swap until the next resync.
- ab2b149: A score override on an IE or AB submission clears its cases, so ioi16 no longer credits a batch the run stopped inside. Best submissions rank a row without a time (an overridden CE, IE or AB) after every timed row of equal points.
- 279bbde: The posts sitemap and the sitemap index count posts published after the API started; the publish-time filter is now built per request instead of once at boot.
- be355ea: Sync API: a contest PUT keeps the isPretested, maxSubmissions and outputPrefixOverride set on each remaining problem instead of resetting them to defaults.

## 2.34.8

### Patch Changes

- ddd79ec: `PATCH /api/internal/admin/users/{username}/access` also accepts a superuser's API token; its audit record carries the comment `via API token`. Any other API token, and every other session-only route, still answers 403 `This endpoint requires a browser session`.

## 2.34.7

### Patch Changes

- 720f52f: Polygon sync: a kept checker or interactor keeps the headers it compiles with, and the headers count as part of both settings. An import marks the compile checks of the sources it replaced as pending inside its transaction, so a failed file step no longer shows the old file's result. The bridge refreshes the judge features a queued submission needs on every resync. The problem package manifest includes `interactiveChecker` and `helperHeaders`.

## 2.34.6

### Patch Changes

- ccd9ff3: Polygon import: an interactive problem's checker runs after the interactor (`interactive.checker`), bridged checkers compile with the package's headers, and both checker and interactor get a compile check at import. The bridge sends such problems only to judges that advertise `interactive.checker`. A sync that keeps a local grader keeps its `interactiveChecker` too, and an import compile-checks only the sources it wrote.

## 2.34.5

### Patch Changes

- fb192d1: Polygon import jobs: a failed job, link and sync run carry `errorCode` and `errorParams` (`PolygonImportErrorCode`) besides the English message, and a job says whether it is `retryable`; a waiting job shows its `queuePosition`; a completed job's `result.summary` lists the checker mapping, tests, cases, batches and clamped limits, and `result.attention` (code `imported_needs_attention`) a problem imported whose finishing steps failed; `GET /problems/imports?mine=1` lists the caller's jobs; an outage or a missing judge is retried once after 2 min; automatic syncs queue behind manual imports; an import or sync whose statement languages or testcase count would fail is refused before queueing.
- fb192d1: `PATCH /problems/{code}/polygon` edits the link's import options (main and mapped statement languages, tutorial language, zero-point batches and cases, main solution) besides `autoSync`, every field optional; changed options are checked against Polygon like a sync and apply from the next sync. The link response shows `options`.
- d159b01: Polygon link check: a running or failed newest package answers `polygon_package_not_ready` with its state and Polygon's comment (`newestPackage`), also on a problem's first check; the first check downloads the package once at a time (`polygon_link_checking` otherwise) under a 600 s proxy timeout; the preview lists the statement languages and their tutorials; `statementLanguages` takes `<language>=skip` to leave a statement out.
- d159b01: Polygon sync: one job per problem and package for manual syncs too (a second sync joins the one in flight, and a sync of a package another sync already applied ends as ok); every sync uses the link's testcase limit; `GET /problems/{code}/polygon` returns the running job id, which the problem's editors may poll; a package download fails after a minute without data instead of a fixed 10 minutes, and a broken-off body is `polygon_unavailable`.
- 9087a52: A Polygon sync keeps the time and memory limits, partial scoring, checker (type, arguments, source) and grader settings edited on QHHOJ since the last import instead of overwriting them; `POST /problems/{code}/polygon/sync` takes `{overwriteLocalEdits: true}` to restore the package's values (409 `polygon_sync_queued` while a sync keeping them is queued), and the job's `result.localEdits` lists the kept and updated settings. A sync also keeps `unicode`, `nobigmath`, `outputPrefix` and `outputLimit`. `imported_needs_attention` sends `{step}`, a missing problem group or type fails with `catalog_missing`, the link check hides Polygon's build comment until the link token is checked, and a sync rerun after a worker restart fails visibly instead of reporting ok.

## 2.34.4

### Patch Changes

- b42cec7: Polygon import: run every `std::*` checker except hcmp from the package's own `check.cpp` (bridged), and stage the package's headers (its `testlib.h` included) beside the interactor.
- 9d65c4e: Polygon link import treats empty authors, curators and types as not given: an update keeps the problem's catalog and a create gets the default type.
- db2961b: Free a Polygon problem for a new import when the problem linked to it is purged (the purge clears the link); a link held by a problem still in its deletion grace period answers 409 `polygon_linked_deleted` with `linkedProblemCode`. One problem per Polygon problem is now enforced by a unique index and re-checked in the import transaction, and `POST /internal/polygon/resolve` takes an optional `code` so a problem may re-check its own link.
- 82aff3a: Polygon import: emit 0-point rows after all scoring rows, count only distinct tests against the testcase limit, refuse one-sided file I/O, and refuse rescaled fractional points with a custom checker unless its points are percentages.

## 2.34.3

### Patch Changes

- ef0cb00: Add `languageKey` to contest language stats and profile PP submission rows.

## 2.34.2

### Patch Changes

- f3d23c7: Accept `red` as an appearance accent.

## 2.34.1

### Patch Changes

- 413b41e: Organization storage quota: `QuotaLedger.assertStorage(organizationId, addedBytes)` reads the organization's stored bytes itself; the api and worker call sites no longer sum usage.

## 2.34.0

### Minor Changes

- dadbd98: `GET /organizations?canCreate=problem|contest` lists the organizations the viewer may create that for (administrator, or `judge.edit_all_organization`, holding `judge.create_organization_problem` or `judge.create_private_contest`): the set the organization create routes accept. 401 when anonymous.
- f6899b7: Submission list rows (`GET /submissions`, the contest, organization and best lists) carry `contest` ({key, name, points, minute}) like the submission detail, under the same `canSee` rule; null outside a contest and for a contest the viewer may not see.

### Patch Changes

- a32de32: The rating run's warning for a board it could not purge now names the affected contest ids and the failure reason.

## 2.33.0

### Minor Changes

- 79fdad5: `POST /organizations/:slug/leave` lets an administrator leave while another administrator remains (dropping their admin rights, recorded in the history); the last administrator gets 409 with issue `last_admin`.
- cde6b4b: Contest questions: `POST/GET /contests/:key/tickets` file and list tickets tied to a contest (optionally one of its problems by code); tickets carry `contest`, the `contest` link type exists, and the contest's editors read its tickets. Problem tickets filed from inside a contest are tied to it. Announcements render `#C` as `<a class="problem-ref">`: with the problem's href once its code is public to the contest's viewers (ended, or a visible board after the start), label-only before that for the reader's page to resolve.
- cb91fbb: Signup (`POST /auth/register` and the social completion) defaults the account's language to C++17 when none is chosen.
- 2f39d2c: `GET /submissions/:id` carries `contest`: the key and name of the contest it was submitted in, the points it scores there (worked out as the scoreboard stores them, so a read right after judging is already exact), and, for the submitter's own submission made within its run, the run minute as the scoreboard counts it. It is null outside a contest and for a viewer who may not see that contest.
- 02a7955: Tickets: `POST`/`DELETE /tickets/{id}/claim` takes a ticket or hands it back (staff, editors of the linked problem and editors of the contest it was filed from; a second claimer gets 409 `ticket_claimed`, also when both click at once; a closed ticket 409 `ticket_closed`), `can.claim` on the detail, list filters `aboutMine` (tickets about the caller's own problems, and tickets filed from contests they author or curate) and `q` (title text ignoring accents, or creator username), and `aboutMineOpen` in the ticket summary.
- 9cbb531: `GET /users/:username` returns `submissionCount`: the user's submissions the viewer may see, the same total as the submission list filtered to the user.

### Patch Changes

- ac5f3df: Contests: an editor who creates contests only for organizations (no `judge.add_contest` or `judge.edit_all_contest`) can add, remove or flip only organizations they may create contests for, on edit and on clone, and cannot move a contest out of every organization (403 `organization_rights` / `site_contest_rights` on `organizations`). Opening a visible private contest to everyone needs `judge.change_contest_visibility`. A save that changes organizations holds only while the stored organizations are unchanged (409 otherwise).
- a7e4f46: Site contest creators (`judge.add_contest`) now scope a contest only to organizations they administer with `judge.create_private_contest`, on create, edit and clone (403 `organization_rights`). Before, they could scope a contest to any organization and charge that organization's credits. A contest that stays public may still list any organization. `judge.edit_all_contest` holders and superusers keep any organization.
- 56b5128: An edit of `isVisible`, `isPrivate` or `isOrganizationPrivate` saves only while the stored three flags still match what the visibility gate checked (409 otherwise). Before, two concurrent edits that the gate allowed one at a time, such as showing a private contest and clearing the privacy of a hidden one, could combine to publish it without `judge.change_contest_visibility`.
- d64f3b9: Setting or clearing a contest's `timeLimit` queues a contest rescore. When a limit is set, a live row's start moves from the contest start to its join time, so its cell times and cumulative time went stale. Changing one limit to another does not rescore.
- 77517bd: Organizations: each row of `GET /organizations/:slug/problems` (and the tag write's answer) carries `canEdit`, whether the viewer may edit that problem, so the organization's problem list can show a pencil to its editor.
- 1f92855: An edit that makes a public problem visible to everyone by leaving organization privacy (a move onto the site, or clearing `isOrganizationPrivate`) now needs `judge.change_public_visibility`, including for `judge.edit_all_problem` holders (403 `site_publish_rights`). Before, an organization admin with `judge.add_problem` could publish a members-only problem to the whole site. Without the permission, an edit of `isPublic` or `isOrganizationPrivate` saves only while both still match what its gates checked (409 otherwise).
- 2bc8ee1: A rating run also purges the cached boards of contests whose ratings it deletes (a contest that stopped being rated), and a failed purge no longer fails the job once the ratings are committed: it logs a warning and the boards expire after `scoreboardCacheTimeout`.
- 0bf8f53: Contest rating now leaves out unlisted users who are not banned (staff and test accounts). They get no rating row and no longer shift other participants' rank or rating change. Banned users are unlisted too but are still rated, so a disqualified cheater keeps the last-place penalty. Contests already rated keep their stored ratings until they are re-rated.

## 2.32.0

### Minor Changes

- 20ec361: The reason of an organization join request is optional: `POST /organizations/:slug/requests` takes a missing, blank or null `reason` as an empty one (still at most 4096 characters).
- 5226a1e: Ranking rows and the contest viewer carry `ratingChange` (`rating`, `delta` from the previous rating, null on a first rating) once a rated contest's ratings are applied; null on a frozen board. A rating run purges the cached boards of the contests it rates.

## 2.31.0

### Minor Changes

- 7772534: Submission results are public: `GET /submissions/:id` and its live stream answer visitors and viewers without source access (verdict, points, cases), with a new `sourceAccess` field. Source, raw and download keep the source rule; feedback, program output and the compile log come only with source access.

## 2.30.0

### Minor Changes

- ccc3564: Contest clone takes an optional `startTime` that shifts the copy's window; an editor's contest detail recounts participants and repairs a drifted stored count.

## 2.29.4

### Patch Changes

- 9ca5921: Worker boot empties contest summaries that hold the old site's format options as JSON (copying an option the stored format config lacks), and logs found/cleared counts and the contest keys.

## 2.29.3

### Patch Changes

- aa9f3e4: Worker boot moves the internal-error message left on submissions overridden before 2.29.2 into the override revision, and logs found/cleared/skipped counts.

## 2.29.2

### Patch Changes

- 7e33f05: Internal-error messages (they can quote jury data) reach only the problem's editors: one `shownError` gate on the submission `error`, and a score override moves the message from the row to its revision.

## 2.29.1

### Patch Changes

- 4482cc9: Moving a problem between organizations keeps its code: the organization prefix is checked only for a new code (and on create and import), not on a move, a flip to private or a reorder.

## 2.29.0

### Minor Changes

- 815ebc5: Problem editors may move a problem between organizations, and between the site and an organization, with the organization creation rights in every organization added or removed (403 `organization_rights`) and `judge.add_problem` to leave all organizations (403 `site_problem_rights`). The code is never renamed (400 `organization_code_prefix`); a move into an organization spends its problem credits and must fit its storage.

## 2.28.1

### Patch Changes

- 4ec28b5: Polygon: a package download answered with an HTTP error is 502 `polygon_package_unavailable`; unreachable Polygon and error pages are logged with their cause or status.

## 2.28.0

### Minor Changes

- 80e2299: Profile: `bitRoam` `{ on, count }` (count 1-5, default `{ on: false, count: 1 }`) stores the roaming-Bits preference; PATCH replaces it whole. Included in the user data export.

## 2.27.0

### Minor Changes

- c1db3af: Polygon: `judge.import_polygon_package` is removed and its holders get the new `judge.sync_polygon_problem` (migrated on worker boot). Imports need only the rights of the change (create or test data write access); sync, auto-sync and link changes need the new permission plus test data write access; the link state and its history need only the write access. Syncs of organization-private problems are checked against the organization's storage; turning auto-sync on makes the switcher the user it runs as.

### Patch Changes

- a8e4197: Judging: ioi16 credits batches only from fully graded (D) runs; non-partial problems in ioi16/final_submission contests are judged without short-circuit; a run's deadline is re-armed from its Started case count and kept across a judge resume; a user-aborted run hitting its deadline ends AB.
- c518225: Problem data: saving `nobigmath` or cases graded with different checkers is refused with a field error (judge-v2 answered every submission UNSUPPORTED). Bridge: SLOTS_FULL on an Assign sends that run back to QU without spending its requeue, kept off that judge until the next resync tick, instead of ending the session; a late SLOTS_FULL for a released run frees its slot.

## 2.26.0

### Minor Changes

- 7f6eb78: The one-off `problem-databytes` backfill (now `problem-databytes-backfill-v2`, runs once on the next worker boot) also measures the stored PDF statement and material of every problem, so files uploaded before 2.25.0 count against organization storage.

## 2.25.0

### Minor Changes

- cc399b7: Problem files: administrators of an organization-private problem's organizations may upload and remove its PDF statement and material without `judge.upload_file_statement` / `judge.upload_problem_material`; the files count against the organization's storage. New `DELETE /problems/{code}/statement` and `/material`, editor flags `canUploadPdfStatement` / `canUploadMaterial`, and `materialExtensions` in the problem meta.

## 2.24.0

### Minor Changes

- 2cf0e61: Problem detail: `io` (mode `stdio` or `file`, plus the input/output file names) so the statement page can show how a solution reads and writes.

## 2.23.1

### Patch Changes

- 4925821: chore: remove duplicate submission_file dir constant

## 2.23.0

### Minor Changes

- 639d840: Organization problem creators without `judge.import_polygon_package` may use the zip and Polygon imports to create problems for their organizations (`organization` required; no update, no auto-sync). A failed organization import gives its credits back once (worker); a package downloaded from Polygon is checked against the organization's storage. Imported organization problems are announced like ones created on the site. `DiscordWebhooksService` moves to `@libs/community`, the shared quota primitives to `QuotaLedger` in `@libs/problems`.

## 2.22.0

### Minor Changes

- 702808d: Polygon import (zip and link) takes an optional `organization` slug on create: the problem is private to that organization, needs its creation rights instead of `judge.add_problem`, the code prefix, and is charged to its quota (credits when queued, storage of the package).

## 2.21.1

### Patch Changes

- a4232eb: chore: remove unused devDependencies (@eslint/eslintrc, source-map-support) and share one pino level list between env validation and nestLogLevels.

## 2.21.0

### Minor Changes

- 6dd4737: Setting `organization.adminRoleId`: the role every new organization admin gets (on create and on `adminIds` edits; never removed on demotion). Empty falls back to the role named "Org Admin".

## 2.20.0

### Minor Changes

- ccca5b3: feat(problems): compile an uploaded checker or interactor on a judge (`generate.compile`, proto 1.3) and show the result as `sourceChecks` on the problem data

## 2.19.1

### Patch Changes

- 5d02b48: Remove the finished one-off comment-numbers backfill worker job.

## 2.19.0

### Minor Changes

- f5ea530: `editor.canPublishToMembers` on the problem detail: an organization creator may set `isPublic` on an organization-private problem.

## 2.18.0

### Minor Changes

- f3dff56: feat(problems): data PUT refuses checker and grader arguments the judge does not read (400 `invalid` on `checkerArgs`, `graderArgs`, `cases.N.checkerArgs`); checkers `rstripped`, `sorted`, `unordered`, `easy`, `linematches` can be chosen
- b5ebc7c: `POST /organizations/{slug}/problems` and `POST /organizations/{slug}/contests` create organization-private problems and contests for the organization's administrators who hold `judge.create_organization_problem` / `judge.create_private_contest` (no `add_problem` / `add_contest`). Organization problem codes must start with the slug prefix (`thpt-demo` → `thptdemo_`, 400 `organization_code_prefix`; superusers exempt; checked again only when the code or organizations change). Organization problem creators may set `isPublic` (members only) on their organization's private problems. The organization `viewer` gains `canCreateProblem` / `canCreateContest`; session `adminCapabilities` gains `problemCreation` / `contestCreation` (`{ site, organizations }`).

## 2.17.3

### Patch Changes

- 8f2a59f: chore: remove unused profile settings (aceTheme, mathEngine, userScript, display badge) and the never-read vnojPoints prop
- ebe0c8e: chore: remove unused exports and the stale navigation wording from the site docs and OpenAPI tag description.

## 2.17.2

### Patch Changes

- deb3319: chore: remove unused exports from worker and similarity modules

## 2.17.1

### Patch Changes

- bbc8690: chore: remove unused exports in problems

## 2.17.0

### Minor Changes

- c32c6b5: Submission lists (`/submissions`, contest and organization lists) carry `testSummary`: the first 100 case verdicts (or batch verdicts) with the problem's case count, only for viewers who could see them on the submission page.

### Patch Changes

- c88575e: chore: remove unused exports in contests (replay refusal, best submissions, final-judge queue helpers).

## 2.16.1

### Patch Changes

- 8f13df9: Bridge quadlet mounts `/srv/qhhoj/media` read-only, so judges can fetch file-only (OUTPUT zip) submissions. Host step: re-run `install-host.sh` (or install the unit), `systemctl daemon-reload`, restart `qhhoj-bridge`.

## 2.16.0

### Minor Changes

- f82f622: Judges: `POST /judges/{name}/rename` (offline judges with nothing in flight; queued and pending pins follow), `blockReason` on the judge PATCH and response (cleared on unblock), and `ipHistory` (last 20 addresses with first/last seen and connection count, written by the bridge at each Hello). Languages: `isActive` (inactive languages are hidden from a problem's `allowedLanguages`, left out of new problems' defaults and refused at submit with 400 `language_inactive`) and `order` (lists sort by order, then name), plus `GET /admin/languages/usage` (problems allowing each language, submissions over the last 30 days).

### Patch Changes

- de63a8f: Contest best submissions rank by the contest's points (the contest submission's row), so a partial result on a problem without partial scores scores 0 and is left out, as on the ranking.

## 2.15.0

### Minor Changes

- c6c8e14: Polygon: import and sync from a standard package, generating its tests on a judge with test generation (new `generating` step, `type` on the latest package, `packageType` on sync runs).

## 2.14.0

### Minor Changes

- a50bcd9: Add `GET /admin/audit`: the global change log over `revisions` and `settingRevisions`, newest first, with actor, object label and changed field names, filtered by actor, type and time range.
- 1afe3f1: Admin content: settled comment reports and bulk settle, locked comment pages list, ticket retitle/relink and `awaiting` filter, misc config history, post filter by organization slug, flatpage search.
- 61cdbcb: External judge API: settings connection test, per-problem link (get/put/delete/search/verify with language suggestions), public status, submit checks, external run on submission detail.
- bffa38d: Bridge: external judge adapter (`@external`) submits external problems' submissions to the PCD VJudge, polls them and writes results through the normal run writes.

### Patch Changes

- b9f1d0b: CI runs only the unit and static OpenAPI specs, with no MongoDB or Redis; specs that need them are `*.db.spec.ts` or `*.e2e-spec.ts` and run locally with `npm run test:db`.

## 2.13.0

### Minor Changes

- c5b4965: Contests admin: `GET /contests` gains `visible`, `mine`, `startFrom`, `startBefore` and `sort` (`newest`, `oldest`, `name`, `users`), and an `editor` block per row (`isVisible`, `lockedAfter`, FSO `pendingCount`) for contests the viewer may edit; `POST /contests/bulk/visibility` and `POST /contests/bulk/tag` apply the PATCH per key with per-key `done`/`unchanged`/`failed`; `POST /contests/{key}/participations/disqualify` disqualifies or reinstates up to 100 rows with one rescore; the participation list takes `search` (username contains, editors only); contests store `ogImage` (link previews) and `logoOverrideImage`; editors may run final judging once an FSO contest has started; contest tags carry `contestCount` among the contests the viewer may see.

## 2.12.0

### Minor Changes

- 5c00975: Blog: `GET /posts/drafts` (my drafts and scheduled posts) and `GET /posts/compose-options` (personal and organization posting rights); organization post lists hide other admins' scheduled posts.
- b33289d: External judge core: `externalJudge.*` settings (sealed token), `Problem.externalJudge`, `externalRuns` collection, PCD VJudge client and result mapping.
- d96e09f: Add `DELETE /organizations/{slug}`: a superuser-only soft delete. Problems and contests are unlinked and keep their privacy flags, posts are unlinked and hidden, members are released and pending join requests rejected. Deleted organizations disappear from every read.
- c10d1d6: Add `GET /organizations/:slug/submissions`: the listed members' submissions under the site list's visibility rules, for members, administrators and `judge.view_all_submission`.
- 4c69fb5: Public `GET /runtimes` (judges with slots, ping and uptime; languages with per-judge compiler versions; no keys, addresses or builds). `GET /submissions/:id/source/raw` (inline) and `/source/download` (attachment, `<id>.<ext>`, `Main.java` for Java) as `text/plain` with `nosniff`, under the source's existing access rules.
- 328b719: Add `PUT /submissions/{id}/score`: a manual verdict and score (`judge.change_submission` plus edit rights on the problem) on a finished submission, stored on the problem's scale so contest results (bar ioi16 batches), solved state and rescores agree; optional `lock`, logged as a revision. The submission viewer gains `canOverrideScore`.
- 5969708: Add `GET /user-suggestions?prefix=`: signed-in, rate-limited username prefix search returning up to 10 `{ id, username }` for the admin pickers.

### Patch Changes

- 35f4a02: Bridge: the judge message cap (1000/s) counts a sliding second, so a burst straddling a window edge is caught; a failed read when re-dispatching a requeued run after grace is logged instead of escaping as an unhandled rejection.
- 2fa8249: Bulk problem visibility reports an unexpected failure on one problem as `failed` (`internal_error`) instead of a 500, so the changes already applied are still reported.
- c2ac6ed: The problems-reader registry classifies the organization unlink repository.

## 2.11.0

### Minor Changes

- 0334196: Add `GET /contests/{key}/problems/{code}/best-submissions` (best submission per user on a contest problem, contest submissions only, cut at the freeze, closed when the ranking is hidden) and `canSeeFullScoreboard` / `boardFrozenAt` on the contest viewer.

### Patch Changes

- e9eda16: release tags are created through the GitHub API, not git push
- 2b77b79: Test: two superusers demoting or deactivating each other at once leave one active.

## 2.10.0

### Minor Changes

- 9dff58c: Roles and permissions admin: permission catalog, role list/create/edit, a user's access read and change (add/remove sets); superuser only.

## 2.9.0

### Minor Changes

- 3f4bb5c: Staff user administration under `/admin/users`: `GET`/`PATCH {username}/profile` (display name, full name, about, display rank, unlisted, mute, allow tagging, staff notes, leave current contest, organizations with `judge.change_profile`; e-mail and active flag also need `auth.change_user`), `POST {username}/password` (admin re-enters their own password; revokes the user's sessions and API token; 10 per admin per hour), `POST {username}/password-reset` and `POST {username}/rename` (old name still opens the profile), all `auth.change_user`; `POST /admin/users` creates up to 100 accounts per request (`auth.add_user`; generated password or invite mail, optional organization). Superusers are editable only by superusers; every action is a `user` revision without secrets.

## 2.8.0

### Minor Changes

- 2d1748d: The session user gains `adminCapabilities.organizations`; `GET /problems` and `GET /contests` take `editable`, `GET /organizations` takes `administered`, so the admin screens can open to authors and organization admins who are not staff.
- f56873c: Polygon import by link: `POST /polygon/resolve` checks a pasted problem link (its `p…` token against the `url` in the newest package's problem.xml) and previews the problem; `POST /polygon/import` takes the link in the body. `GET /polygon/problems` and `POST /polygon/problems/{polygonId}/import` are removed, with the shared-list cache. New errors `polygon_link_invalid`, `polygon_link_refused`, `polygon_no_package`; `polygon_already_linked` names the QHHOJ problem (and `linkedProblemCode`) only to its editors.

## 2.7.0

### Minor Changes

- 427836a: Admin content: `GET /admin/comments` (search every comment) and `POST /admin/comments/hidden` (bulk hide); `/admin/posts` takes `search` and the `organization` and `any` states; `visible`, `sticky` or `globalPost` sent alone by `edit_all_post` skips the post write limit; `/admin/discord-webhooks` lists masked targets, sets or removes one event and queues a test message; a `discord.webhooks` patch now merges per event (null removes one).
- be45e16: Contest admin: per-problem rejudge and rescore, contest delete, hand-edited participations (add, move start, delete, recompute), participation list filters (kind, disqualified, score sort), announcement edit and preview, pending final-submission count in the actions status.
- 3918877: Admin judging: bulk rejudge filters by contest, user, ids, date range and judge (problem optional) with a dry-run sample; bulk rescore; recent batch log; submission lock/unlock; judge queue summary; delete an offline judge.
- 304796f: Organization admin: change history (`GET /organizations/{slug}/revisions`; creates, edits with admins by username, member removals), about preview (`POST /organizations/render-preview`), staff points recalculation (`POST /organizations/{slug}/recalculate`), `search` on members and on the staff request queue, `open`/`unlisted` filters on the organization list, `decidedByUsername` on join requests, `slots` on organization list items, issue codes `admin_cap`, `admin_not_kickable`, `not_member`.
- 8664659: Problems admin: `POST /problems/bulk/visibility` publishes or unpublishes up to 100 problems through the PATCH path (optional `setDateToNow`, per-code `done`/`unchanged`/`failed`); `PATCH /problems/{code}` takes `changeMessage` as the revision comment; `GET /problems` gains `authorId` and `suggested` filters and `authors` on each item; the editor block gains `ogImage`; create and edit for problem types, groups and licenses under `/admin/problem-types`, `/admin/problem-groups`, `/admin/licenses` (`judge.add_*`/`judge.change_*` for `problemtype`, `problemgroup`, `license`).
- 4b856f8: Add `robots.txt`, cached sitemaps and link-preview tags for problem, contest, blog and user pages (`/api/internal/seo/*`, mapped by nginx); the public ranking response now carries the contest format.

### Patch Changes

- 0918cff: Classify the SEO repository in the problem-readers spec so backend CI passes again.

## 2.6.1

### Patch Changes

- 7181efa: Polygon import and sync take only full packages (with the Linux variant); a standard-only package is refused with its id, revision and state instead of failing the download with HTTP 500.

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
