import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Submission } from '@libs/database';
import { MIGRATION_RECOMPUTE_QUEUE } from '@libs/judging';
import type { MigrationRecomputeResult } from '@libs/judging';
import { startAfterIndexes } from '../start-after-indexes';
import { MigrationRecomputeService } from './migration-recompute.service';

@Processor(MIGRATION_RECOMPUTE_QUEUE, { concurrency: 1, autorun: false })
export class MigrationRecomputeProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  constructor(
    private readonly recompute: MigrationRecomputeService,
    @InjectModel(Submission.name)
    private readonly submissions: Model<Submission>,
  ) {
    super();
  }

  /** The stats count is hinted to a submissions index. */
  onApplicationBootstrap(): Promise<void> {
    return startAfterIndexes(this.worker, this.submissions);
  }

  process(): Promise<MigrationRecomputeResult> {
    return this.recompute.run();
  }
}
