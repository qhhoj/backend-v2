import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { ServiceClientPrincipal } from '@libs/auth';
import { AppError } from '@libs/common';
import { CONTEST_FINAL_JUDGE_QUEUE, finalJudgeJobId } from '@libs/contests';
import type { ContestFinalJudgeJob } from '@libs/contests';
import { uuidStr } from '@libs/database';
import { isFrozenForSync } from './sync-contest-fields';
import { SyncContestOwnership } from './sync-contest-ownership.service';
import { SyncParticipantsRepository } from './sync-participants.repository';
import { SyncRateLimit } from './sync-rate-limit.service';

@Injectable()
export class SyncContestRemovalService {
  private readonly logger = new Logger(SyncContestRemovalService.name);

  constructor(
    private readonly ownership: SyncContestOwnership,
    private readonly participants: SyncParticipantsRepository,
    private readonly rateLimit: SyncRateLimit,
    @InjectQueue(CONTEST_FINAL_JUDGE_QUEUE)
    private readonly finalJudges: Queue<ContestFinalJudgeJob>,
  ) {}

  /** Only while no person has published the contest, it has not started and nobody submitted: after that other people depend on it. */
  async remove(client: ServiceClientPrincipal, key: string): Promise<void> {
    await this.rateLimit.charge(client);
    const contest = await this.ownership.require(client, key);
    if (isFrozenForSync(contest, new Date()))
      throw new AppError(
        'contest_not_deletable',
        409,
        'A published or started contest cannot be deleted',
      );
    if (await this.participants.hasSubmissions(contest._id))
      throw new AppError(
        'contest_not_deletable',
        409,
        'A contest with submissions cannot be deleted',
      );
    await this.participants.deleteUnstarted(contest._id);
    await this.finalJudges
      .remove(finalJudgeJobId(uuidStr(contest._id), contest.endTime))
      .catch((error: Error) =>
        this.logger.error(
          `Final-judge job of ${key} not removed: ${error.message}`,
        ),
      );
    this.logger.log(
      JSON.stringify({
        event: 'sync.contest.deleted',
        client: client.clientId,
        key,
      }),
    );
  }
}
