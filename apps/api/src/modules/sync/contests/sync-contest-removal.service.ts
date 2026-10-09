import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import type { ServiceClientPrincipal } from '@libs/auth';
import { AppError, REDIS } from '@libs/common';
import {
  CONTEST_FINAL_JUDGE_QUEUE,
  finalJudgeJobId,
  purgeRankingCache,
} from '@libs/contests';
import type { ContestFinalJudgeJob } from '@libs/contests';
import { uuidStr } from '@libs/database';
import type { ContestDocument } from '../../contests/core/contests.repository';
import { isFrozenForSync } from './sync-contest-fields';
import { SyncActsAsService } from './sync-acts-as.service';
import { SyncContestOwnership } from './sync-contest-ownership.service';
import { SyncParticipantsRepository } from './sync-participants.repository';
import { SyncRateLimit } from './sync-rate-limit.service';

const notDeletable = (message: string) =>
  new AppError('contest_not_deletable', 409, message);

@Injectable()
export class SyncContestRemovalService {
  private readonly logger = new Logger(SyncContestRemovalService.name);

  constructor(
    private readonly ownership: SyncContestOwnership,
    private readonly actsAs: SyncActsAsService,
    private readonly participants: SyncParticipantsRepository,
    private readonly rateLimit: SyncRateLimit,
    @InjectQueue(CONTEST_FINAL_JUDGE_QUEUE)
    private readonly finalJudges: Queue<ContestFinalJudgeJob>,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Only while no person has published the contest, it has not started and nobody submitted: after that other people depend on it. The delete itself re-states those conditions, so a publish in between wins. */
  async remove(client: ServiceClientPrincipal, key: string): Promise<void> {
    await this.rateLimit.charge(client);
    const contest = await this.ownership.require(client, key);
    await this.actsAs.principalOf(client);
    const now = new Date();
    if (isFrozenForSync(contest, now))
      throw notDeletable('A published or started contest cannot be deleted');
    if (await this.participants.hasSubmissions(contest._id))
      throw notDeletable('A contest with submissions cannot be deleted');
    const owner = { clientId: client.clientId, now };
    if (!(await this.participants.deleteUnstarted(contest._id, owner)))
      throw notDeletable('The contest changed meanwhile and was kept');
    await this.clearLeftovers(contest, key);
    this.logger.log(
      JSON.stringify({
        event: 'sync.contest.deleted',
        client: client.clientId,
        key,
      }),
    );
  }

  /** The final-judge job and the cached board; a failure is logged, the contest is already gone. */
  private async clearLeftovers(
    contest: ContestDocument,
    key: string,
  ): Promise<void> {
    await this.finalJudges
      .remove(finalJudgeJobId(uuidStr(contest._id), contest.endTime))
      .catch((error: Error) =>
        this.logger.error(
          `Final-judge job of ${key} not removed: ${error.message}`,
        ),
      );
    await purgeRankingCache(this.redis, contest._id).catch((error: Error) =>
      this.logger.error(`Ranking cache of ${key} not purged: ${error.message}`),
    );
  }
}
