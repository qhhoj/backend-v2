# QHHOJ

An online judge for competitive programming: problems, submissions judged in a sandbox, contests and organizations. This glossary is shared by backend-v2, frontend-v2 and judge-v2; the other two repos point here.

This file holds **domain words** (what a thing is, and what not to call it). Code identifiers (`principal`, `viewer`, `payload`, `Ms` suffixes) are in CONTRIBUTING.md, section Glossary.

## Problems

**Editorial**:
The write-up explaining a problem's solution, shown to users with or after the problem.
_Avoid_: Solution, tutorial (except for Polygon's source), lời giải (ambiguous)

**Tutorial**:
Polygon's name for the source of an Editorial inside a Polygon package. Only used when talking about Polygon import.
_Avoid_: using it for the Editorial itself

**Main solution**:
The problem setter's reference program for a problem.
_Avoid_: Solution, model code

**Public problem**:
A problem anyone can see.
_Avoid_: Open problem

**Organization problem**:
A problem visible only to members of the organizations it lists.
_Avoid_: Private problem (ambiguous)

**Hidden problem**:
A problem that is neither public nor an Organization problem; only its Problem editors and Testers see it.
_Avoid_: Private problem, draft

**Owning organization**:
The first organization listed on an Organization problem. Any other problem has no Owning organization.
_Avoid_: Problem owner, org of the problem

**Author**:
A person credited on a problem who may edit it.
_Avoid_: Setter, creator

**Curator**:
A person who may edit a problem without being credited on it.
_Avoid_: Maintainer, co-author

**Tester**:
A person who may see and submit to a problem while it is Hidden.
_Avoid_: Reviewer, beta tester

**Problem editors**:
A problem's Authors and Curators together.
_Avoid_: Owners, staff

**Points**:
A problem's value, from 800 to 3500, shown with the problem.
_Avoid_: Score, difficulty

## Contests

**Participation**:
One user's entry in a contest; it is Live, Virtual or Spectating.
_Avoid_: Registration, join, attempt

**Live participation**:
A Participation during the contest's own time window.
_Avoid_: Official participation

**Virtual participation**:
A Participation that replays a finished contest in its own time window; a user may have several, numbered.
_Avoid_: Practice, upsolve

**Spectating**:
A Participation that only watches the contest and never submits.
_Avoid_: Observer, guest

**Final judging**:
In a contest that judges only at the end, the one Judging each held Submission gets after the contest ends.
_Avoid_: Systest, late judging

**Score**:
What one Submission or one Participation earns.
_Avoid_: Points (for a contest result)

**Rating**:
A user's contest strength, updated from rated contests.
_Avoid_: Elo, points

**User points**:
A user's total from the problems they solved.
_Avoid_: Score, rating

## Judging

**Submission**:
A user's source code for a problem, in one language.
_Avoid_: Run, solution, attempt

**Judging**:
One grading pass of a Submission, numbered by its generation; it produces one verdict. A rejudge, final judging or judge loss starts a new Judging of the same Submission.
_Avoid_: Run, attempt, grading

**Run**:
One sandboxed execution of one program (the contestant's program, a checker or an interactor) on one test.
_Avoid_: Execution, Judging

**Rejudge**:
A new Judging of a Submission that already finished, started by staff.
_Avoid_: Regrade, retest

**Verdict**:
The outcome of a Judging or of one test: Accepted, Wrong Answer, Time Limit Exceeded, Compile Error, Internal Error, Aborted, Rejected and the like.
_Avoid_: Result, status

**Status**:
Where a Judging is in its life: Queued, Pending, Grading or Done.
_Avoid_: Result, state, verdict

**Judge**:
A judging server (judge-v2) that runs Judgings, one per Slot at a time. Never a staff member, never a Verdict.
_Avoid_: Grader, worker, judge server (in prose)

**Slot**:
One place on a Judge where a single Judging runs.
_Avoid_: Worker, lane, core

**Bridge**:
The backend process that Judges connect to and that hands out Judgings.
_Avoid_: Dispatcher, queue

## Quota

**Time**:
The contestant program's CPU time on one test, as shown in a verdict.
_Avoid_: Judging time

**Jury time**:
The CPU time of the checker and the interactor on one test.
_Avoid_: Checker time (it includes the interactor)

**Judging time**:
The sum of Time and Jury time over every test of one Judging. The monthly quota limits an Owning organization's Judging time.
_Avoid_: CPU time, credits

**Judging quota**:
An Owning organization's monthly limit on Judging time.
_Avoid_: Credits, judging credits

**Storage quota**:
An organization's limit on the bytes of its problems' files.
_Avoid_: Disk quota, credits

**Quota month**:
A calendar month in the site's time zone (Vietnam time, UTC+7), over which Judging time adds up.
_Avoid_: Billing period, UTC month

**Unlimited organization**:
An organization with no quotas, like every organization imported from the old site.
_Avoid_: Exempt, free organization

## Submission statuses

**Status codes**:
The stored form of a Status or of a special row. `QU` queued, `P` pending (handed to a Judge, not yet grading), `G` grading, `D` done; `IE` internal error, `CE` compile error, `AB` aborted; `PD` held until final judging (see FSO). `SC` is not a Status: it is a short-circuited test, skipped because an earlier test of its batch failed. `QU`, `P` and `G` are unfinished; `IE` and `PD` do not count against a contest's `maxSubmissions`.
_Avoid_: Verdict codes (the Verdict of a Judging is `result`: AC, WA, TLE...)

**FSO**:
Final submission only: a contest format where Submissions are stored as `PD` while the contest runs and judged once after it ends (Final judging).
_Avoid_: Deferred judging

**Claim**:
The bridge's atomic move of a queued Submission to a Judge (`QU` to `P`), which also bumps the judging generation. One Judge wins a Claim; a lost race matches nothing. A purge or an effects recompute also "claims" a row by stamping it first; the word always means "mark it mine before working".
_Avoid_: Lock, take

**Requeue**:
Putting a Submission back to `QU` after its Judge failed it (lost, refused, timed out). Each Submission has a small requeue allowance; a refusal for a reason the Judge cannot fix (`RETRY` outcome: data unavailable, unsupported, runtime missing) is a requeue that spends none. A rejudge is not a requeue: staff start it and it resets the allowances.
_Avoid_: Retry (that is a BullMQ job attempt, `JOB_RETRY`)

**Grace**:
The time a Judge's held Judgings wait for the Judge to reconnect and resume them (30 s) before they are requeued.
_Avoid_: Timeout

**Winding**:
A Judging the bridge has let go of (accept timeout, rejudge void, resume dropped) whose Judge has not yet ended its process. The Slot stays counted busy until the Judge's final `ABORTED` for it.
_Avoid_: Zombie, leaked run

## Background work

**Effects**:
What a graded Submission changes elsewhere: the user's points and PP, the problem's statistics, solved sets, and for a contest Submission the Participation and ranking. Done by the worker's `submission-effects` job, which recomputes from Mongo and never increments.
_Avoid_: Side effects, post-processing

**Sweep**:
The job that repairs lost Effects every 10 minutes: it recomputes whatever finished grading since its last watermark. Other sweeps (final judging, publish, purge, package cache) do the same kind of repair for their own work.
_Avoid_: Cron (that is only the schedule)

**Resync**:
Reloading a whole in-memory snapshot from Mongo on a timer, in case the change stream missed something (Queriers, settings, the bridge's queue and Judge list). Also the message that asks a client to refetch after lost events.
_Avoid_: Refresh, reload

**Data version**:
A counter on a problem that rises on every change of its test data. A write is a compare-and-set on it, and a package or Test generation records the version it was built for.
_Avoid_: Revision (that is a change-log row)

**Revision**:
One row of the change log (`revisions`): which entity changed, who, and each field's before and after. Written by problem, contest, organization, flatpage and setting edits.
_Avoid_: Version, history entry

**Legacy**:
The old Django/MariaDB site that v2 replaced. Comments that say "legacy" name behaviour kept for parity with it, usually by the old function's name.
_Avoid_: DMOJ (the old site was a fork of it), v1

## Problem data

**Test generation**:
Producing a problem's test files on a Judge by running its generator, instead of uploading them. Started by a Polygon import of a Standard package; the Judge sends the files back and the problem's Data version rises. Not to be confused with the generation number of a Judging.
_Avoid_: Generation (bare), test build

**Full package**:
A Polygon package that contains the problem's source (`problem.xml`, files, solutions) and the built tests.
_Avoid_: Linux package

**Standard package**:
A Polygon package without built tests; its tests come from running the generators (Test generation).
_Avoid_: Source package

**External judge**:
A remote online judge (through the PCD VJudge API) that grades the Submissions of problems mirrored from it, in place of a Judge. The bridge runs the adapter as the pseudo-judge `@external`.
_Avoid_: Remote judge, VJudge (that is only the vendor)

## Classification

**Problem type**:
A broad category of a problem (a short name and a full name); a problem has one or more. Fixed catalog, created and edited by staff, never deleted.
_Avoid_: Category, tag

**Problem group**:
The one named set a problem belongs to, from the old site's catalog. Same rules as a Problem type.
_Avoid_: Permission group

**Tag**:
A label users vote onto a problem (algorithm, technique), kept in a Tag group. Site-wide; organizations have their own labels (see Organization problem tag).
_Avoid_: Category, topic

**Tag group**:
A set of Tags shown together.
_Avoid_: Problem group

**Organization problem tag**:
A label an organization's admins give to that organization's problems. Visible and editable only inside the organization.
_Avoid_: Tag (bare)

**Contest tag**:
A label on a contest from a managed catalog (colours are theme token keys, at most 100). `Contest.tags` stores the slugs.
_Avoid_: Tag (bare)

**Permission group**:
A set of site permissions given to users (the old Django group), such as Org Admin or a staff role. In code, `group` alone means this; elsewhere say Problem group or Tag group.
_Avoid_: Role (the admin screens call a permission group a role)

## Contest extras

**Ghost**:
A fictional participant in a contest's replay, imported from a CSV of solve minutes and wrong tries. Ghosts exist only in the replay board.
_Avoid_: Bot, fake participant

**Balloon**:
A physical balloon delivered to a team's table for a solved problem, tracked on a volunteers' screen. Each first solve of a problem is marked.
_Avoid_: Prize

**Feed**:
The read-only event stream of one contest (NDJSON in the ICPC contest-API style) that resolver tools read, behind its own key.
_Avoid_: Scoreboard feed, RSS (the homepage has RSS/Atom feeds, which are blog and problem lists)

**PP**:
Performance points: a user's weighted sum over their best 300 public problems (0.98514 to the rank, plus 0.05 per solved). An organization has PP too, a separate sum over its members' points (100 entries, 0.95 to the rank).
_Avoid_: Points (that is the value of one problem or User points), rating

## Site content

**Flatpage**:
A static page staff write (`/about`, `/help/faq`), stored as Markdown and rendered HTML under a leading-slash url.
_Avoid_: Static page, article

**Misc config**:
Free-form site values staff edit (the SPA reads them from `GET /site`). Public to everyone, so never a secret; secrets are admin settings.
_Avoid_: Setting (those are runtime settings in the settings registry)

## Polygon

**Polygon link**:
A problem tied to a problem on Polygon, together with its saved import options.
_Avoid_: Polygon binding, Polygon problem (that is the one on Polygon)

**Import**:
Creating a problem from a package. It happens once per problem.
_Avoid_: Re-import (that is a Sync), upload

**Sync**:
Pulling the latest Polygon package into a linked problem.
_Avoid_: Re-import, update, refresh

**Autosync**:
A Sync that runs on a schedule.
_Avoid_: Auto-import, scheduled import

## Organizations

**Organization admin**:
A member who manages one organization.
_Avoid_: Org admin (ambiguous), owner

**Org Admin group**:
The site permission group named "Org Admin", which grants rights over every organization. Distinct from an Organization admin.
_Avoid_: Org admin (bare)

## Judge and Bridge internals

Words used inside judge-v2 and the Bridge. The wire protocol keeps its names; this section says which glossary term each one is. See judge-v2 `docs/architecture.md`.

**Assignment**:
The wire name of a Judging as the Judge sees it: `Assign`, `AssignmentRef {submission_id, generation}`. One Assignment is one Judging.
_Avoid_: Run, job

**Case**:
The judge's word for a test, from init.yml. Case results and Case verdicts are test verdicts.
_Avoid_: Test case (in judge code)

**Batch**:
A group of Cases scored together: its points are awarded only if every Case in it is accepted, and the Bridge scores it by its weakest Case.
_Avoid_: Subtask group (that is the problem-author word)

**Pretest**:
A Case that a pretest run grades instead of the full set (`pretest_test_cases`).
_Avoid_: Sample

**Short-circuit**:
Skipping the remaining Cases once one is not accepted: the rest of a Batch always, and every later Case when the Assign asks for it. Skipped Cases get the verdict code SC.
_Avoid_: Early exit

**Box**:
One isolate sandbox. A Slot owns two: the solution Box (compile and every Run of the contestant's program) and the Jury box.
_Avoid_: Container, sandbox (for the unit)

**Jury box**:
The Box that runs problem-author programs: the checker, the interactor, a generator, a signature entry. The judge code also calls it the helper box.
_Avoid_: Helper box, checker box

**Jury**:
The problem-author programs of a problem, as opposed to the contestant's program: checker, interactor, generator, signature entry.
_Avoid_: Helper, manager, custom, bridged (these name kinds of Jury program, not the idea)

**Session**:
The Judge's one gRPC stream to the Bridge. The judge code also uses the word for an interactor and contestant process pair, which is a Pair in this glossary.
_Avoid_: Connection

**Pair**:
A Jury process and a contestant process running together over a channel, as in an interactive problem (`grader::session`).
_Avoid_: Session (for this meaning)

**Generation**:
The number of a Judging of a Submission. Test generation (Polygon `GenerateTests`) is a different thing and is always called Test generation.
_Avoid_: Generation (bare, for test generation)

**Room**:
The disk space a Box's quota must allow for the files the judge puts in it plus what the Run may write.
_Avoid_: Quota (that is the organization limit)

**Meta**:
isolate's per-Run measurement file: status, exit code or signal, CPU and wall time, memory counters. Every Run verdict is derived from it.
_Avoid_: Report

**Outbox**:
The numbered messages an Assignment has sent and the Bridge has not yet acknowledged. After a reconnect the Judge replays it from the Bridge's last acknowledged number.
_Avoid_: Queue

**Data version**:
The number of the current contents of a problem's data, stamped in `.data-version` by the backend after the last file change. A Judging grades a data version, and the result reports which one it used.
_Avoid_: Stamp (in prose), revision

**Verdict codes**:
The per-test codes: AC accepted, WA wrong answer, TLE time limit exceeded, MLE memory limit exceeded, OLE output limit exceeded, IR invalid return (the program exited with a non-zero code), RTE runtime error (killed by a signal or an uncaught exception), SC short-circuited (skipped).
_Avoid_: Status (that is a Judging's lifecycle)
