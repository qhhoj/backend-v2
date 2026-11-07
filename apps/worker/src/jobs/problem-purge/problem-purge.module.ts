import { Module } from '@nestjs/common';
import { JobsModule } from '@libs/common';
import { problemJobs } from '@libs/problems';
import { ProblemPurgeProcessor } from './problem-purge.processor';
import { ProblemPurgeRepository } from './problem-purge.repository';
import { ProblemPurgeService } from './problem-purge.service';

@Module({
  imports: [JobsModule.register(problemJobs.purge)],
  providers: [
    ProblemPurgeProcessor,
    ProblemPurgeService,
    ProblemPurgeRepository,
  ],
})
export class ProblemPurgeModule {}
