import { Module } from '@nestjs/common';
import { communityJobs } from '@libs/community';
import { contestJobs } from '@libs/contests';
import { JobsModule } from '@libs/common';
import { judgingJobs } from '@libs/judging';
import { ContestPublishProcessor } from './contest-publish.processor';
import { ContestPublishRepository } from './contest-publish.repository';
import { ContestPublishService } from './contest-publish.service';

@Module({
  imports: [
    JobsModule.register(
      contestJobs.publish,
      communityJobs.contributionPoints,
      judgingJobs.problemRescore,
    ),
  ],
  providers: [
    ContestPublishProcessor,
    ContestPublishService,
    ContestPublishRepository,
  ],
})
export class ContestPublishModule {}
