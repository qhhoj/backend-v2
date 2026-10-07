import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CONTEST_RATING_QUEUE } from '@libs/contests';
import { ContestRatingProcessor } from './contest-rating.processor';
import { ContestRatingRepository } from './contest-rating.repository';
import { ContestRatingService } from './contest-rating.service';

@Module({
  imports: [BullModule.registerQueue({ name: CONTEST_RATING_QUEUE })],
  providers: [
    ContestRatingProcessor,
    ContestRatingService,
    ContestRatingRepository,
  ],
})
export class ContestRatingModule {}
