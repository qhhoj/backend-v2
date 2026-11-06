import { Module } from '@nestjs/common';
import { JobsModule } from '@libs/common';
import { judgingJobs } from '@libs/judging';
import { SimilarityEngine } from './similarity-engine';
import { SimilarityProcessor } from './similarity.processor';
import { SimilarityRepository } from './similarity.repository';
import { SimilarityService } from './similarity.service';

@Module({
  imports: [JobsModule.register(judgingJobs.similarity)],
  providers: [
    SimilarityService,
    SimilarityRepository,
    SimilarityEngine,
    SimilarityProcessor,
  ],
})
export class SimilarityModule {}
