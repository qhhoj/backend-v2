import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type Redis from 'ioredis';
import type { Connection } from 'mongoose';
import { REDIS } from '@libs/common';
import { purgeRankingCache } from '@libs/contests';
import { uuidStr } from '@libs/database';
import {
  MIGRATION_REFUSAL,
  MIGRATION_STATE_COLLECTION,
  MIGRATION_STATE_ID,
} from '@libs/judging';
import type { MigrationRecomputeResult } from '@libs/judging';
import { ContributionPointsService } from '../contribution-points/contribution-points.service';
import { OrganizationPointsService } from '../organization-points/organization-points.service';
import { SubmissionEffectsService } from '../submission-effects/submission-effects.service';
import { RatingReplayService } from './rating-replay.service';

const PARALLELISM = 8;

@Injectable()
export class MigrationRecomputeService {
  private readonly logger = new Logger(MigrationRecomputeService.name);

  constructor(
    @InjectConnection() private readonly conn: Connection,
    private readonly effects: SubmissionEffectsService,
    private readonly organizationPoints: OrganizationPointsService,
    private readonly contribution: ContributionPointsService,
    private readonly ratingReplay: RatingReplayService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Ratings come right after the participations (standings); organizations after users (their PP sums members' PP); the ranking caches go last. */
  async run(): Promise<MigrationRecomputeResult> {
    await this.requireMigrationMarker();
    const participations = await this.each('contestParticipations', (id) =>
      this.effects.recomputeParticipation(id),
    );
    const ratings = await this.ratingReplay.replay(new Date());
    const result: MigrationRecomputeResult = {
      participations,
      ...ratings,
      problems: await this.each('problems', (id) =>
        this.effects.recomputeProblem(id),
      ),
      users: await this.each('users', (id) => this.effects.recomputeUser(id)),
      contributors: await this.each('users', (id) =>
        this.contribution.recompute(id),
      ),
      organizations: await this.each('organizations', (id) =>
        this.organizationPoints.recompute(id),
      ),
      contests: await this.each('contests', async (id) => {
        await purgeRankingCache(this.redis, id);
      }),
    };
    this.logger.log(`Migration recompute done: ${JSON.stringify(result)}`);
    return result;
  }

  /** The replay wipes every rating: only a database a backfill marked may run it. */
  private async requireMigrationMarker(): Promise<void> {
    const marked = await this.conn
      .collection(MIGRATION_STATE_COLLECTION)
      .countDocuments({ _id: MIGRATION_STATE_ID } as never);
    if (!marked) throw new Error(MIGRATION_REFUSAL);
  }

  private async each(
    collection: string,
    work: (id: string) => Promise<void>,
  ): Promise<number> {
    let count = 0;
    let chunk: string[] = [];
    const flush = async () => {
      await Promise.all(chunk.map(work));
      count += chunk.length;
      chunk = [];
    };
    const cursor = this.conn
      .collection(collection)
      .find({}, { projection: { _id: 1 } })
      .sort({ _id: 1 });
    for await (const { _id } of cursor)
      if (chunk.push(uuidStr(_id)) === PARALLELISM) await flush();
    await flush();
    return count;
  }
}
