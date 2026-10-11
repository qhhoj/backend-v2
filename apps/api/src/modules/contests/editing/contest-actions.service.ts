import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { Principal } from '@libs/auth';
import {
  CONTEST_EXPORT_QUEUE,
  CONTEST_FINAL_JUDGE_QUEUE,
  CONTEST_PUBLISH_QUEUE,
  CONTEST_RATING_QUEUE,
  CONTEST_REPLAY_QUEUE,
  CONTEST_RESCORE_QUEUE,
  contestActionState,
} from '@libs/contests';
import type {
  ContestExportJob,
  ContestFinalJudgeJob,
  ContestPublishJob,
  ContestRatingJob,
  ContestReplayJob,
  ContestRescoreJob,
} from '@libs/contests';
import { ContestsRepository } from '../core/contests.repository';
import { ContestsService } from '../core/contests.service';
import type { ContestActionsResponse } from './dto/contest-actions.response';

@Injectable()
export class ContestActionsService {
  constructor(
    private readonly contestsService: ContestsService,
    private readonly contests: ContestsRepository,
    @InjectQueue(CONTEST_RESCORE_QUEUE)
    private readonly rescores: Queue<ContestRescoreJob>,
    @InjectQueue(CONTEST_FINAL_JUDGE_QUEUE)
    private readonly finalJudges: Queue<ContestFinalJudgeJob>,
    @InjectQueue(CONTEST_RATING_QUEUE)
    private readonly ratings: Queue<ContestRatingJob>,
    @InjectQueue(CONTEST_PUBLISH_QUEUE)
    private readonly publishes: Queue<ContestPublishJob>,
    @InjectQueue(CONTEST_REPLAY_QUEUE)
    private readonly replays: Queue<ContestReplayJob>,
    @InjectQueue(CONTEST_EXPORT_QUEUE)
    private readonly exports: Queue<ContestExportJob>,
  ) {}

  /** Editors only, like `rescore`. The automatic final judging at the end is not an editor's request, so it is filtered out. */
  async status(
    principal: Principal,
    key: string,
  ): Promise<ContestActionsResponse> {
    const contest = await this.contestsService.editableContest(principal, key);
    const [rescore, judgeFinal, rate, publish, replay, dataExport, pending] =
      await Promise.all([
        contestActionState(this.rescores, contest._id),
        contestActionState(
          this.finalJudges,
          contest._id,
          (data) => data.manual,
        ),
        contestActionState(this.ratings, contest._id),
        contestActionState(this.publishes, contest._id),
        contestActionState(this.replays, contest._id),
        contestActionState(this.exports, contest._id),
        contest.formatName === 'final_submission'
          ? this.contests.countPendingSubmissions(contest._id)
          : 0,
      ]);
    const outcome = contest.autoPublishOutcome;
    return {
      rescore,
      judgeFinal,
      rate,
      publish,
      replay,
      export: dataExport,
      autoPublish: outcome && {
        at: outcome.at,
        status: outcome.status,
        reason: outcome.reason,
        published: outcome.published,
        skipped: outcome.skipped,
      },
      pendingCount: pending,
    };
  }
}
