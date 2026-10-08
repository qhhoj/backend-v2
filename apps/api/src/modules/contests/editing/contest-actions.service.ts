import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { Principal } from '@libs/auth';
import {
  CONTEST_FINAL_JUDGE_QUEUE,
  CONTEST_RATING_QUEUE,
  CONTEST_RESCORE_QUEUE,
  contestActionState,
} from '@libs/contests';
import type {
  ContestFinalJudgeJob,
  ContestRatingJob,
  ContestRescoreJob,
} from '@libs/contests';
import { ContestsService } from '../core/contests.service';
import type { ContestActionsResponse } from './dto/contest-actions.response';

@Injectable()
export class ContestActionsService {
  constructor(
    private readonly contestsService: ContestsService,
    @InjectQueue(CONTEST_RESCORE_QUEUE)
    private readonly rescores: Queue<ContestRescoreJob>,
    @InjectQueue(CONTEST_FINAL_JUDGE_QUEUE)
    private readonly finalJudges: Queue<ContestFinalJudgeJob>,
    @InjectQueue(CONTEST_RATING_QUEUE)
    private readonly ratings: Queue<ContestRatingJob>,
  ) {}

  /** Editors only, like `rescore`. The automatic final judging at the end is not an editor's request, so it is filtered out. */
  async status(
    principal: Principal,
    key: string,
  ): Promise<ContestActionsResponse> {
    const contest = await this.contestsService.editableContest(principal, key);
    const [rescore, judgeFinal, rate] = await Promise.all([
      contestActionState(this.rescores, contest._id),
      contestActionState(this.finalJudges, contest._id, (data) => data.manual),
      contestActionState(this.ratings, contest._id),
    ]);
    return { rescore, judgeFinal, rate };
  }
}
