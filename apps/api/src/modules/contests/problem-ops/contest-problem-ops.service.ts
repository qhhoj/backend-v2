import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { Principal } from '@libs/auth';
import { AppError } from '@libs/common';
import { CONTEST_RESCORE_QUEUE, enqueueContestRescore } from '@libs/contests';
import type { ContestRescoreJob } from '@libs/contests';
import { uuidStr } from '@libs/database';
import { ProblemsRepository } from '../../problems/core/problems.repository';
import type { BulkRejudgeResponse } from '../../submissions/actions/dto/bulk-rejudge.dto';
import { SubmissionActionsService } from '../../submissions/actions/submission-actions.service';
import type { ContestDocument } from '../core/contests.repository';
import { ContestsService } from '../core/contests.service';
import type { QueuedResponse } from '../core/dto/queued.response';
import type { ContestProblemRejudgeDto } from './dto/contest-problem-ops.dto';

/** Legacy contest admin per-problem `rejudge_view` and `rescore_view`, for contest editors. */
@Injectable()
export class ContestProblemOpsService {
  constructor(
    private readonly contestsService: ContestsService,
    private readonly problems: ProblemsRepository,
    private readonly submissionActions: SubmissionActionsService,
    @InjectQueue(CONTEST_RESCORE_QUEUE)
    private readonly rescores: Queue<ContestRescoreJob>,
  ) {}

  /** The bulk-rejudge rules (limit, locked, in-flight, dry run) over the problem's submissions in this contest only. */
  async rejudge(
    principal: Principal,
    key: string,
    code: string,
    options: ContestProblemRejudgeDto,
  ): Promise<BulkRejudgeResponse> {
    const { contest, problemId } = await this.contestProblem(
      principal,
      key,
      code,
    );
    return this.submissionActions.contestProblemRejudge(
      principal,
      { contestId: contest._id, problemId },
      options,
    );
  }

  /** Queues a rescore of the problem's contest submissions and of the participations that sent one. */
  async rescore(
    principal: Principal,
    key: string,
    code: string,
  ): Promise<QueuedResponse> {
    const { contest, problemId } = await this.contestProblem(
      principal,
      key,
      code,
    );
    await enqueueContestRescore(this.rescores, contest._id, { problemId });
    return { queued: true };
  }

  /** An editable contest and a live problem listed in it; anything else is 404 `not_found`. */
  private async contestProblem(
    principal: Principal,
    key: string,
    code: string,
  ): Promise<{ contest: ContestDocument; problemId: string }> {
    const contest = await this.contestsService.editableContest(principal, key);
    const problem = await this.problems.findByCode(code);
    const isListed =
      problem !== null &&
      contest.problems.some((entry) => uuidStr(entry.problem) === problem._id);
    if (!isListed)
      throw new AppError(
        'not_found',
        404,
        'The problem is not in this contest',
      );
    return { contest, problemId: problem._id };
  }
}
