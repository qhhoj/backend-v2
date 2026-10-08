import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { RateLimitService } from '@libs/common';
import { SIMILARITY_QUEUE } from '@libs/judging';
import { SimilarityAccessService } from './core/similarity-access.service';
import { SimilarityRunsRepository } from './core/similarity-runs.repository';
import { SimilarityRunsController } from './runs/similarity-runs.controller';
import { SimilarityRunsService } from './runs/similarity-runs.service';
import { SimilarityLaunchService } from './start/similarity-launch.service';
import { SimilarityStartController } from './start/similarity-start.controller';
import { SimilarityStartService } from './start/similarity-start.service';

/** Code similarity runs: core/ (access, repository, shared dto), start/ (start a run), runs/ (list and detail). */
@Module({
  imports: [BullModule.registerQueue({ name: SIMILARITY_QUEUE })],
  controllers: [SimilarityStartController, SimilarityRunsController],
  providers: [
    SimilarityAccessService,
    SimilarityRunsRepository,
    SimilarityStartService,
    SimilarityLaunchService,
    SimilarityRunsService,
    RateLimitService,
  ],
})
export class SimilarityApiModule {}
