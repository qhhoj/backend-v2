import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { hasPermission } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError } from '@libs/common';
import {
  IN_FLIGHT_STATUSES,
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
import type { FilterQuery } from 'mongoose';
import { ProblemAccess } from '../../problems/core/problem-access';
import { ProblemsService } from '../../problems/core/problems.service';
import type {
  BulkRejudgeDto,
  BulkRejudgeResponse,
} from './dto/bulk-rejudge.dto';
import { BULK_REJUDGE_LIMIT } from '../core/rate-limits';
import {
  isSubmissionLocked,
  mayAbortSubmission,
  mayRejectSubmission,
  mayRejudgeSubmission,
} from '../core/submission-access';
import { SubmissionsRepository } from '../core/submissions.repository';
import { SubmissionsService } from '../core/submissions.service';

/** `ProblemAccess.canEdit` on the problem, the edit half of every manage check. */
const editsProblem = (principal: Principal, problem: Problem): boolean =>
  ProblemAccess.canEdit(principal, ProblemAccess.accessView(problem));

const cannotManageProblem = (): AppError =>
  new AppError(
    'forbidden',
    403,
    'You cannot manage submissions of this problem',
  );

/** What a bulk rejudge never resets: submissions a judge holds, pending final-submission rows (contest judging owns them) and, unless forced, locked ones. */
function rejudgeableFilter(
  force: boolean | undefined,
): FilterQuery<Submission> {
  return {
    status: { $nin: [...IN_FLIGHT_STATUSES, 'PD'] },
    ...(force
      ? {}
      : { $or: [{ lockedAfter: null }, { lockedAfter: { $gt: new Date() } }] }),
  };
}

/** Legacy `apply_submission_filter` for one problem. */
function bulkFilter(
  problemId: string,
  dto: BulkRejudgeDto,
): FilterQuery<Submission> {
  const idRange = {
    ...(dto.idFrom ? { $gte: dto.idFrom } : {}),
    ...(dto.idTo ? { $lte: dto.idTo } : {}),
  };
  return {
    problem: problemId,
    ...rejudgeableFilter(dto.force),
    ...(Object.keys(idRange).length ? { _id: idRange } : {}),
    ...(dto.languages?.length ? { language: { $in: dto.languages } } : {}),
    ...(dto.results?.length ? { result: { $in: dto.results } } : {}),
  };
}

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

  /** Every matching submission of one problem, at batch priority; publishes no events (up to 100k `queued` would flood every feed; pages see `processing` from the bridge); above `BULK_REJUDGE_LIMIT` needs `judge.rejudge_submission_lot`. */
  async bulkRejudge(
    principal: Principal,
    dto: BulkRejudgeDto,
  ): Promise<BulkRejudgeResponse> {
    const problem = await this.problems.visibleProblemOutsideContest(
      principal,
      dto.problem,
    );
    if (!mayRejudgeSubmission(principal, editsProblem(principal, problem)))
      throw cannotManageProblem();
    return this.rejudgeMatching(
      principal,
      bulkFilter(problem._id, dto),
      dto.dryRun === true,
    );
  }

  /** Legacy contest admin `rejudge_view`: every submission sent to the problem inside the contest. The caller has checked edit rights on the contest; the rejudge permission stands in for edit rights on the problem, which a contest editor may lack. */
  async contestProblemRejudge(
    principal: Principal,
    target: { contestId: string; problemId: string },
    options: { force?: boolean; dryRun?: boolean },
  ): Promise<BulkRejudgeResponse> {
    if (!mayRejudgeSubmission(principal, true)) throw cannotManageProblem();
    const filter: FilterQuery<Submission> = {
      contest: target.contestId,
      problem: target.problemId,
      ...rejudgeableFilter(options.force),
    };
    return this.rejudgeMatching(principal, filter, options.dryRun === true);
  }

  /** Counts first: above `BULK_REJUDGE_LIMIT` needs `judge.rejudge_submission_lot`; a dry run stops at the count. */
  private async rejudgeMatching(
    principal: Principal,
    filter: FilterQuery<Submission>,
    dryRun: boolean,
  ): Promise<BulkRejudgeResponse> {
    const matching = await this.submissions.countMatching(filter);
    const allowed =
      matching <= BULK_REJUDGE_LIMIT ||
      hasPermission(principal, 'judge.rejudge_submission_lot');
    if (dryRun) return { count: matching, dryRun: true, allowed };
    if (!allowed)
      throw new AppError(
        'forbidden',
        403,
        `Rejudging more than ${BULK_REJUDGE_LIMIT} submissions needs judge.rejudge_submission_lot`,
      );
    return {
      count: await this.rejudgeChunks(filter),
      dryRun: false,
      allowed,
    };
  }

  /** The command may carry ids that raced into P/G; the bridge only loads queued ones. */
  private async rejudgeChunks(
    filter: FilterQuery<Submission>,
  ): Promise<number> {
    let count = 0;
    for await (const ids of this.submissions.idChunks(filter)) {
      count += await this.submissions.resetForJudging(
        ids,
        SUBMISSION_PRIORITY.batchRejudge,
      );
      await this.commands.judge(ids);
    }
    return count;
  }

  private notifyGraded(submission: Submission): Promise<void> {
    return notifyGraded(this.graded, gradedJobOf(submission), this.logger);
  }
}
