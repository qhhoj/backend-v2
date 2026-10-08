import { Module } from '@nestjs/common';
import { SimilarityEngine } from './similarity-engine';
import { SimilarityRepository } from './similarity.repository';
import { SimilarityService } from './similarity.service';

@Module({
  providers: [SimilarityService, SimilarityRepository, SimilarityEngine],
  exports: [SimilarityService],
})
export class SimilarityModule {}
