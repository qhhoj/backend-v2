import { Module } from '@nestjs/common';
import { JobsModule } from '@libs/common';
import { contestJobs } from '@libs/contests';
import { ContestDataProcessor } from './contest-data.processor';
import { ContestDataRepository } from './contest-data.repository';
import { ContestDataService } from './contest-data.service';
import { CONTEST_DATA_LIMITS, DEFAULT_CONTEST_DATA_LIMITS } from './data-zip';

@Module({
  imports: [JobsModule.register(contestJobs.data)],
  providers: [
    ContestDataProcessor,
    ContestDataService,
    ContestDataRepository,
    { provide: CONTEST_DATA_LIMITS, useValue: DEFAULT_CONTEST_DATA_LIMITS },
  ],
})
export class ContestDataModule {}
