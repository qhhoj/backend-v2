import { Module } from '@nestjs/common';
import { JobsModule } from '@libs/common';
import { contestJobs } from '@libs/contests';
import { ContestDataProcessor } from './contest-data.processor';
import { ContestDataRepository } from './contest-data.repository';
import { ContestDataService } from './contest-data.service';

@Module({
  imports: [JobsModule.register(contestJobs.data)],
  providers: [ContestDataProcessor, ContestDataService, ContestDataRepository],
})
export class ContestDataModule {}
