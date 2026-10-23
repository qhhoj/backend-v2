# QHHOJ

An online judge for competitive programming: problems, submissions judged in a sandbox, contests and organizations. This glossary is shared by backend-v2, frontend-v2 and judge-v2; the other two repos point here.

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
