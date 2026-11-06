import { Module } from '@nestjs/common';
import { JobsModule } from '@libs/common';
import { contestJobs } from '@libs/contests';
import { ContestRatingProcessor } from './contest-rating.processor';
import { ContestRatingRepository } from './contest-rating.repository';
import { ContestRatingService } from './contest-rating.service';

@Module({
  imports: [JobsModule.register(contestJobs.rating)],
  providers: [
    ContestRatingProcessor,
    ContestRatingService,
    ContestRatingRepository,
  ],
})
export class ContestRatingModule {}
