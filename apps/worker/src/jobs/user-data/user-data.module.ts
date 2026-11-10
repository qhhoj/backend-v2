import { Module } from '@nestjs/common';
import { JobsModule } from '@libs/common';
import { communityJobs } from '@libs/community';
import { UserDataProcessor } from './user-data.processor';
import { UserDataCommunityRepository } from './user-data-community.repository';
import { UserDataRepository } from './user-data.repository';
import { UserDataService } from './user-data.service';

@Module({
  imports: [JobsModule.register(communityJobs.userData)],
  providers: [
    UserDataProcessor,
    UserDataService,
    UserDataRepository,
    UserDataCommunityRepository,
  ],
})
export class UserDataModule {}
