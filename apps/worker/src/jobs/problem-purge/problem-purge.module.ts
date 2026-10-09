import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { PROBLEM_PURGE_QUEUE } from '@libs/problems';
import { ProblemPurgeProcessor } from './problem-purge.processor';
import { ProblemPurgeRepository } from './problem-purge.repository';
import { ProblemPurgeService } from './problem-purge.service';

@Module({
  imports: [BullModule.registerQueue({ name: PROBLEM_PURGE_QUEUE })],
  providers: [
    ProblemPurgeProcessor,
    ProblemPurgeService,
    ProblemPurgeRepository,
  ],
})
export class ProblemPurgeModule {}
