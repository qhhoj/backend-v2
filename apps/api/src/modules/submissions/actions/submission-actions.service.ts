import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { Principal } from '@libs/auth';
import { AppError } from '@libs/common';
import {
  SUBMISSION_PRIORITY,
  UNFINISHED_STATUSES,
  uuidStr,
} from '@libs/database';
import type { Problem, Submission } from '@libs/database';
import {
  BridgeCommandsService,
  gradedJobOf,
  notifyGraded,
  SUBMISSION_GRADED_QUEUE,
  submissionEvent,
  SubmissionEventsService,
} from '@libs/judging';
import type { SubmissionGradedJob } from '@libs/judging';
import { ProblemAccess } from '../../problems/core/problem-access';
import { ProblemsService } from '../../problems/core/problems.service';
import { RevisionsRepository } from '../../problems/core/revisions.repository';
import {
  isInternalError,
  isSubmissionLocked,
  mayAbortSubmission,
  mayLockSubmission,
  mayOverrideSubmissionScore,
  mayRejectSubmission,
  mayRejudgeSubmission,
} from '../core/submission-access';
import { SubmissionsRepository } from '../core/submissions.repository';
import { SubmissionsService } from '../core/submissions.service';
import type { ScoreOverrideDto } from './dto/score-override.dto';
import { overriddenScore } from './score-override';
import type { OverriddenScore } from './score-override';

/** `ProblemAccess.canEdit` on the problem, the edit half of every manage check. */
const editsProblem = (principal: Principal, problem: Problem): boolean =>
  ProblemAccess.canEdit(principal, ProblemAccess.accessView(problem));

/** What a score override writes and logs. The row will read as graded, so `shownError` would show an internal error's message to everyone: the message moves off the row into the revision, which only staff read. */
const overrideWrites = (
  submission: Submission,
  score: OverriddenScore,
  lockedAfter: Date | undefined,
) => {
  const internalError = isInternalError(submission) ? submission.error : null;
  return {
    fields: {
      ...score,
      ...(lockedAfter && { lockedAfter }),
      ...(internalError !== null && { error: null }),
    },
    changes: {
      result: { before: submission.result, after: score.result },
      points: { before: submission.points, after: score.points },
      ...(lockedAfter && {
        lockedAfter: { before: submission.lockedAfter, after: lockedAfter },
      }),
      ...(internalError !== null && {
        error: { before: internalError, after: null },
      }),
    },
  };
};

const cannotManageProblem = (): AppError =>
  new AppError(
    'forbidden',
    403,
    'You cannot manage submissions of this problem',
  );

/** A deleted or tombstoned problem's submissions are history: a rejudge or reject would overwrite their stored result and cases while the problem's data is gone or about to be purged. */
function assertProblemLive(problem: { deletedAt?: Date | null }): void {
  if (!problem.deletedAt) return;
  const message = 'The problem is deleted; restore it first';
  throw new AppError('problem_deleted', 409, message, undefined, undefined, {
    issues: [{ field: 'problem', code: 'problem_deleted', message }],
  });
}

@Injectable()
export class SubmissionActionsService {
  private readonly logger = new Logger(SubmissionActionsService.name);

  constructor(
    private readonly submissions: SubmissionsRepository,
    private readonly problems: ProblemsService,
    private readonly visibility: SubmissionsService,
    private readonly commands: BridgeCommandsService,
    private readonly events: SubmissionEventsService,
    private readonly revisions: RevisionsRepository,
    @InjectQueue(SUBMISSION_GRADED_QUEUE)
    private readonly graded: Queue<SubmissionGradedJob>,
  ) {}

  /** Legacy `abort_submission`: the owner (unless an admin rejudged it) or `judge.abort_any_submission`. Queued → AB here; running → the bridge terminates it; finished → nothing. */
  async abort(principal: Principal, id: string): Promise<void> {
    const { submission } = await this.visibility.visible(
      principal,
      id,
      await this.visibility.viewerScope(principal),
    );
    const isOwner = uuidStr(submission.user) === principal.userId;
    if (
      !mayAbortSubmission(principal, {
        isOwner,
        rejudgedDate: submission.rejudgedDate,
      })
    )
      throw new AppError('forbidden', 403, 'You cannot abort this submission');
    if (!UNFINISHED_STATUSES.includes(submission.status)) return;
    if (await this.submissions.abortQueued(id)) {
      await this.notifyGraded(submission);
      await this.events.publish(
        submissionEvent(gradedJobOf(submission), 'done', 'AB'),
      );
    }
    await this.commands.publish({ type: 'abort', submissionId: id });
  }

  /** `judge.rejudge_submission` on an editable problem, with no contest scope (legacy checks none); a locked submission or one a judge holds is a conflict. */
  async rejudge(principal: Principal, id: string): Promise<void> {
    const { submission, problem } = await this.visibility.visible(
      principal,
      id,
      null,
    );
    if (!mayRejudgeSubmission(principal, editsProblem(principal, problem)))
      throw cannotManageProblem();
    assertProblemLive(problem);
    if (isSubmissionLocked(submission.lockedAfter))
      throw new AppError('conflict', 409, 'The submission is locked');
    if (submission.status === 'PD')
      throw new AppError(
        'conflict',
        409,
        'Pending final-submission rows are judged when the contest ends',
      );
    if (
      !(await this.submissions.resetForJudging(
        [id],
        SUBMISSION_PRIORITY.rejudge,
      ))
    )
      throw new AppError('conflict', 409, 'The submission is being judged');
    await this.events.publish(
      submissionEvent(gradedJobOf(submission), 'queued', 'QU'),
    );
    await this.commands.judge([id]);
  }

  /** `judge.reject_submission` on an editable problem, with no contest scope, once judging is over. */
  async reject(principal: Principal, id: string): Promise<void> {
    const { submission, problem } = await this.visibility.visible(
      principal,
      id,
      null,
    );
    if (!mayRejectSubmission(principal, editsProblem(principal, problem)))
      throw cannotManageProblem();
    assertProblemLive(problem);
    if (!(await this.submissions.reject(id)))
      throw new AppError(
        'conflict',
        409,
        'The submission is still being judged',
      );
    await this.notifyGraded(submission);
    await this.events.publish(
      submissionEvent(gradedJobOf(submission), 'done', submission.status),
    );
  }

  /** Legacy submission admin's score fields (`judge.change_submission` on an editable problem), once judging is over. The row reads as graded with the given verdict and points; the case results stay as judged. `lock` also locks it so a rejudge cannot discard the override. Logged as a `submission` revision with the comment. */
  async overrideScore(
    principal: Principal,
    id: string,
    dto: ScoreOverrideDto,
  ): Promise<void> {
    const { submission, problem } = await this.visibility.visible(
      principal,
      id,
      null,
    );
    if (
      !mayOverrideSubmissionScore(principal, editsProblem(principal, problem))
    )
      throw cannotManageProblem();
    assertProblemLive(problem);
    const score = overriddenScore(dto, problem);
    const lockedAfter =
      dto.lock && !isSubmissionLocked(submission.lockedAfter)
        ? new Date()
        : undefined;
    const isUnchanged =
      submission.status === 'D' &&
      submission.result === score.result &&
      submission.points === score.points &&
      submission.casePoints === score.casePoints &&
      submission.caseTotal === score.caseTotal &&
      !lockedAfter;
    if (isUnchanged) return;
    const { fields, changes } = overrideWrites(submission, score, lockedAfter);
    if (
      !(await this.submissions.overrideScore(
        id,
        submission.judgeGeneration,
        fields,
      ))
    )
      throw new AppError(
        'conflict',
        409,
        'The submission is still being judged or waits for its contest to end',
      );
    await this.revisions.append({
      entity: 'submission',
      entityId: id,
      action: 'override_score',
      userId: principal.userId,
      changes,
      comment: dto.comment,
    });
    await this.notifyGraded(submission);
    await this.events.publish(
      submissionEvent(gradedJobOf(submission), 'done', 'D'),
    );
  }

  /** Legacy `locked_after` on the submission form: `judge.lock_submission` and edit rights on the problem. A locked submission is skipped by bulk rejudges (unless forced) and refused by a single rejudge. Logged as a `submission` revision. */
  async setLock(
    principal: Principal,
    id: string,
    locked: boolean,
  ): Promise<void> {
    const { submission, problem } = await this.visibility.visible(
      principal,
      id,
      null,
    );
    if (!mayLockSubmission(principal, editsProblem(principal, problem)))
      throw cannotManageProblem();
    // Already in the asked state: no write, no revision. Locking replaces a contest's future lock with a lock now.
    const unchanged = locked
      ? isSubmissionLocked(submission.lockedAfter)
      : submission.lockedAfter === null;
    if (unchanged) return;
    const lockedAfter = locked ? new Date() : null;
    await this.submissions.setLockedAfter(id, lockedAfter);
    await this.revisions.append({
      entity: 'submission',
      entityId: id,
      action: locked ? 'lock' : 'unlock',
      userId: principal.userId,
      changes: {
        lockedAfter: { before: submission.lockedAfter, after: lockedAfter },
      },
      comment: '',
    });
  }

  private notifyGraded(submission: Submission): Promise<void> {
    return notifyGraded(this.graded, gradedJobOf(submission), this.logger);
  }
}
