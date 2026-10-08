import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { SIMILARITY_QUEUE } from '@libs/judging';
import { SimilarityEngine } from './similarity-engine';
import { SimilarityProcessor } from './similarity.processor';
import { SimilarityRepository } from './similarity.repository';
import { SimilarityService } from './similarity.service';

@Module({
  imports: [BullModule.registerQueue({ name: SIMILARITY_QUEUE })],
  providers: [
    SimilarityService,
    SimilarityRepository,
    SimilarityEngine,
    SimilarityProcessor,
  ],
  exports: [SimilarityService],
})
export class SimilarityModule {}
