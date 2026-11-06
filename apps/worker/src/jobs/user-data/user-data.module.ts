import { Module } from '@nestjs/common';
import { JobsModule } from '@libs/common';
import { communityJobs } from '@libs/community';
import { UserDataProcessor } from './user-data.processor';
import { UserDataCommunityRepository } from './user-data-community.repository';
import { UserDataRepository } from './user-data.repository';
import {
  DEFAULT_USER_DATA_LIMITS,
  USER_DATA_LIMITS,
  UserDataService,
} from './user-data.service';

@Module({
  imports: [JobsModule.register(communityJobs.userData)],
  providers: [
    UserDataProcessor,
    UserDataService,
    UserDataRepository,
    UserDataCommunityRepository,
    { provide: USER_DATA_LIMITS, useValue: DEFAULT_USER_DATA_LIMITS },
  ],
})
export class UserDataModule {}
