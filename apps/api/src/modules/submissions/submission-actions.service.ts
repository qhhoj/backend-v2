import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
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
  enqueueGraded,
  gradedJobOf,
  PUBLISH_TIMEOUT_MS,
  SUBMISSION_GRADED_QUEUE,
  withinTimeout,
} from '@libs/judging';
import type { SubmissionGradedJob } from '@libs/judging';
import type { FilterQuery } from 'mongoose';
import { ProblemAccess } from '../problems/problem-access';
import { ProblemsRepository } from '../problems/problems.repository';
import { ProblemsService } from '../problems/problems.service';
import type {
  BulkRejudgeDto,
  BulkRejudgeResponse,
} from './dto/bulk-rejudge.dto';
import { BULK_REJUDGE_LIMIT } from './rate-limits';
import { SubmissionsRepository } from './submissions.repository';
import type { SubmissionDocument } from './submissions.repository';

const isLocked = (submission: Submission): boolean =>
  submission.lockedAfter !== null && submission.lockedAfter < new Date();

/** Legacy `apply_submission_filter` for one problem; submissions a judge holds are never reset. */
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
    status: { $nin: [...IN_FLIGHT_STATUSES] },
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
  constructor(
    private readonly submissions: SubmissionsRepository,
    private readonly problems: ProblemsService,
    private readonly problemsRepository: ProblemsRepository,
    private readonly commands: BridgeCommandsService,
    @InjectQueue(SUBMISSION_GRADED_QUEUE)
    private readonly graded: Queue<SubmissionGradedJob>,
  ) {}

  /** Legacy `abort_submission`: the owner (unless an admin rejudged it) or `judge.abort_any_submission`. Queued → AB here; running → the bridge terminates it; finished → nothing. */
  async abort(principal: Principal, id: string): Promise<void> {
    const submission = await this.found(id);
    const isOwner = uuidStr(submission.user) === principal.userId;
    if (
      !hasPermission(principal, 'judge.abort_any_submission') &&
      (!isOwner || submission.rejudgedDate !== null)
    )
      throw new AppError('forbidden', 403, 'You cannot abort this submission');
    if (!UNFINISHED_STATUSES.includes(submission.status)) return;
    const abortedHere = await this.submissions.abortQueued(id);
    await this.commands.publish({ type: 'abort', submissionId: id });
    if (abortedHere) await this.enqueueGraded(submission);
  }

  /** `judge.rejudge_submission` on an editable problem; a locked submission or one a judge holds is a conflict. */
  async rejudge(principal: Principal, id: string): Promise<void> {
    const submission = await this.found(id);
    await this.assertManages(principal, submission, 'judge.rejudge_submission');
    if (isLocked(submission))
      throw new AppError('conflict', 409, 'The submission is locked');
    if (
      !(await this.submissions.resetForJudging(
        [id],
        SUBMISSION_PRIORITY.rejudge,
      ))
    )
      throw new AppError('conflict', 409, 'The submission is being judged');
    await this.commands.judge([id]);
  }

  /** `judge.reject_submission` on an editable problem, once judging is over. */
  async reject(principal: Principal, id: string): Promise<void> {
    const submission = await this.found(id);
    await this.assertManages(principal, submission, 'judge.reject_submission');
    if (!(await this.submissions.reject(id)))
      throw new AppError(
        'conflict',
        409,
        'The submission is still being judged',
      );
    await this.enqueueGraded(submission);
  }

  /** Every matching submission of one problem, at batch priority; above `BULK_REJUDGE_LIMIT` needs `judge.rejudge_submission_lot`. */
  async bulkRejudge(
    principal: Principal,
    dto: BulkRejudgeDto,
  ): Promise<BulkRejudgeResponse> {
    const problem = await this.problems.visibleProblem(principal, dto.problem);
    this.assertManagesProblem(principal, problem, 'judge.rejudge_submission');
    const ids = await this.submissions.idsMatching(
      bulkFilter(problem._id, dto),
    );
    if (
      ids.length > BULK_REJUDGE_LIMIT &&
      !hasPermission(principal, 'judge.rejudge_submission_lot')
    )
      throw new AppError(
        'forbidden',
        403,
        `Rejudging more than ${BULK_REJUDGE_LIMIT} submissions needs judge.rejudge_submission_lot`,
      );
    const count = await this.submissions.resetForJudging(
      ids,
      SUBMISSION_PRIORITY.batchRejudge,
    );
    await this.commands.judge(ids);
    return { count };
  }

  /** Bounded like the bridge commands, so a Redis outage fails the request instead of hanging it. */
  private enqueueGraded(submission: Submission): Promise<void> {
    return withinTimeout(
      enqueueGraded(this.graded, gradedJobOf(submission)),
      PUBLISH_TIMEOUT_MS,
    );
  }

  private async found(id: string): Promise<SubmissionDocument> {
    const submission = await this.submissions.findById(id);
    if (!submission) throw new AppError('not_found', 404, 'No such submission');
    return submission;
  }

  private async assertManages(
    principal: Principal,
    submission: Submission,
    permission: Permission,
  ): Promise<void> {
    const problem = await this.problemsRepository.findById(
      uuidStr(submission.problem),
    );
    if (!problem) throw new AppError('not_found', 404, 'No such submission');
    this.assertManagesProblem(principal, problem, permission);
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
