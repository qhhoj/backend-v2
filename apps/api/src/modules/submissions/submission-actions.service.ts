import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { hasPermission } from '@libs/auth';
import type { Permission, Principal } from '@libs/auth';
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
import { ProblemAccess } from '../problems/problem-access';
import { ProblemsService } from '../problems/problems.service';
import type {
  BulkRejudgeDto,
  BulkRejudgeResponse,
} from './dto/bulk-rejudge.dto';
import { BULK_REJUDGE_LIMIT } from './rate-limits';
import { SubmissionsRepository } from './submissions.repository';
import { SubmissionsService } from './submissions.service';

const isLocked = (submission: Submission): boolean =>
  submission.lockedAfter !== null && submission.lockedAfter < new Date();

/** Legacy `apply_submission_filter` for one problem; submissions a judge holds are never reset, and pending final-submission rows belong to contest judging. */
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
    status: { $nin: [...IN_FLIGHT_STATUSES, 'PD'] },
    ...(Object.keys(idRange).length ? { _id: idRange } : {}),
    ...(dto.languages?.length ? { language: { $in: dto.languages } } : {}),
    ...(dto.results?.length ? { result: { $in: dto.results } } : {}),
    ...(dto.force
      ? {}
      : { $or: [{ lockedAfter: null }, { lockedAfter: { $gt: new Date() } }] }),
  };
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
      !hasPermission(principal, 'judge.abort_any_submission') &&
      (!isOwner || submission.rejudgedDate !== null)
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
    this.assertManagesProblem(principal, problem, 'judge.rejudge_submission');
    if (isLocked(submission))
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
    this.assertManagesProblem(principal, problem, 'judge.reject_submission');
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
    this.assertManagesProblem(principal, problem, 'judge.rejudge_submission');
    const filter = bulkFilter(problem._id, dto);
    if (
      !hasPermission(principal, 'judge.rejudge_submission_lot') &&
      (await this.submissions.countMatching(filter)) > BULK_REJUDGE_LIMIT
    )
      throw new AppError(
        'forbidden',
        403,
        `Rejudging more than ${BULK_REJUDGE_LIMIT} submissions needs judge.rejudge_submission_lot`,
      );
    let count = 0;
    // The command may carry ids that raced into P/G; the bridge only loads queued ones.
    for await (const ids of this.submissions.idChunks(filter)) {
      count += await this.submissions.resetForJudging(
        ids,
        SUBMISSION_PRIORITY.batchRejudge,
      );
      await this.commands.judge(ids);
    }
    return { count };
  }

  private notifyGraded(submission: Submission): Promise<void> {
    return notifyGraded(this.graded, gradedJobOf(submission), this.logger);
  }

  /** Legacy `is_rejudgeable_by` / `is_rejectable_by`: the permission and edit rights on the problem. */
  private assertManagesProblem(
    principal: Principal,
    problem: Problem,
    permission: Permission,
  ): void {
    if (
      !hasPermission(principal, permission) ||
      !ProblemAccess.canEdit(principal, ProblemAccess.accessView(problem))
    )
      throw new AppError(
        'forbidden',
        403,
        'You cannot manage submissions of this problem',
      );
  }
}
