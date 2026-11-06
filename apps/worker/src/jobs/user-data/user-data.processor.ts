import { Injectable } from '@nestjs/common';
import { JobProcessor } from '@libs/common';
import { communityJobs } from '@libs/community';
import type { UserDataJob } from '@libs/community';
import { UserDataService } from './user-data.service';

@Injectable()
export class UserDataProcessor extends JobProcessor<UserDataJob, number>(
  communityJobs.userData,
  communityJobs.userDataSweep,
) {
  constructor(private readonly data: UserDataService) {
    super();
  }

  run({ userId }: UserDataJob): Promise<number> {
    return this.data.prepare(userId);
  }

  sweep(): Promise<number> {
    return this.data.sweep();
  }
}
