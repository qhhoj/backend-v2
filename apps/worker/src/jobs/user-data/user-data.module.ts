import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { USER_DATA_QUEUE } from '@libs/community';
import { UserDataProcessor } from './user-data.processor';
import { UserDataCommunityRepository } from './user-data-community.repository';
import { UserDataRepository } from './user-data.repository';
import {
  DEFAULT_USER_DATA_LIMITS,
  USER_DATA_LIMITS,
  UserDataService,
} from './user-data.service';

@Module({
  imports: [BullModule.registerQueue({ name: USER_DATA_QUEUE })],
  providers: [
    UserDataProcessor,
    UserDataService,
    UserDataRepository,
    UserDataCommunityRepository,
    { provide: USER_DATA_LIMITS, useValue: DEFAULT_USER_DATA_LIMITS },
  ],
})
export class UserDataModule {}
