import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { RateLimitService } from '@libs/common';
import { SIMILARITY_QUEUE } from '@libs/judging';
import { SimilarityAccessService } from './similarity-access.service';
import { SimilarityRunsController } from './similarity-runs.controller';
import { SimilarityRunsRepository } from './similarity-runs.repository';
import { SimilarityRunsService } from './similarity-runs.service';

@Module({
  imports: [BullModule.registerQueue({ name: SIMILARITY_QUEUE })],
  controllers: [SimilarityRunsController],
  providers: [
    SimilarityRunsService,
    SimilarityAccessService,
    SimilarityRunsRepository,
    RateLimitService,
  ],
})
export class SimilarityApiModule {}
