import { Injectable } from '@nestjs/common';
import type { Principal } from '@libs/auth';
import { InjectJob } from '@libs/common';
import type { JobProducer } from '@libs/common';
import { contestActionState, contestJobs } from '@libs/contests';
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
    @InjectJob(contestJobs.rescore)
    private readonly rescores: JobProducer<ContestRescoreJob>,
    @InjectJob(contestJobs.finalJudge)
    private readonly finalJudges: JobProducer<ContestFinalJudgeJob>,
    @InjectJob(contestJobs.rating)
    private readonly ratings: JobProducer<ContestRatingJob>,
    @InjectJob(contestJobs.publish)
    private readonly publishes: JobProducer<ContestPublishJob>,
    @InjectJob(contestJobs.replay)
    private readonly replays: JobProducer<ContestReplayJob>,
    @InjectJob(contestJobs.export)
    private readonly exports: JobProducer<ContestExportJob>,
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
