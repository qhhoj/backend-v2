import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CONTEST_DATA_QUEUE } from '@libs/contests';
import { ContestDataProcessor } from './contest-data.processor';
import { ContestDataRepository } from './contest-data.repository';
import { ContestDataService } from './contest-data.service';
import { CONTEST_DATA_LIMITS, DEFAULT_CONTEST_DATA_LIMITS } from './data-zip';

@Module({
  imports: [BullModule.registerQueue({ name: CONTEST_DATA_QUEUE })],
  providers: [
    ContestDataProcessor,
    ContestDataService,
    ContestDataRepository,
    { provide: CONTEST_DATA_LIMITS, useValue: DEFAULT_CONTEST_DATA_LIMITS },
  ],
})
export class ContestDataModule {}
