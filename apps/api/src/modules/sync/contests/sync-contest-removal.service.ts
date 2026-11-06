import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import type { ServiceClientPrincipal } from '@libs/auth';
import { AppError, InjectJob, REDIS } from '@libs/common';
import type { JobProducer } from '@libs/common';
import {
  contestJobs,
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
    @InjectJob(contestJobs.finalJudge)
    private readonly finalJudges: JobProducer<ContestFinalJudgeJob>,
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

  /** The final-judge job (best effort) and the cached board; a failure is logged, the contest is already gone. */
  private async clearLeftovers(
    contest: ContestDocument,
    key: string,
  ): Promise<void> {
    await this.finalJudges.withdraw(
      finalJudgeJobId(uuidStr(contest._id), contest.endTime),
    );
    await purgeRankingCache(this.redis, contest._id).catch((error: Error) =>
      this.logger.error(`Ranking cache of ${key} not purged: ${error.message}`),
    );
  }
}
