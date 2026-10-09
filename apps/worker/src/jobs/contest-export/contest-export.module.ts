import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CONTEST_EXPORT_QUEUE } from '@libs/contests';
import {
  CONTEST_EXPORT_LIMITS,
  DEFAULT_CONTEST_EXPORT_LIMITS,
} from './contest-export.limits';
import { ContestExportProcessor } from './contest-export.processor';
import { ContestExportRepository } from './contest-export.repository';
import { ContestExportService } from './contest-export.service';

/** Builds contest submission exports: `<contestId>.export.zip` beside the data zips. */
@Module({
  imports: [BullModule.registerQueue({ name: CONTEST_EXPORT_QUEUE })],
  providers: [
    ContestExportProcessor,
    ContestExportService,
    ContestExportRepository,
    { provide: CONTEST_EXPORT_LIMITS, useValue: DEFAULT_CONTEST_EXPORT_LIMITS },
  ],
})
export class ContestExportModule {}
