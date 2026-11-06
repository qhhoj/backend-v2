import { Module } from '@nestjs/common';
import { JobsModule } from '@libs/common';
import { contestJobs } from '@libs/contests';
import {
  CONTEST_EXPORT_LIMITS,
  DEFAULT_CONTEST_EXPORT_LIMITS,
} from './contest-export.limits';
import { ContestExportProcessor } from './contest-export.processor';
import { ContestExportRepository } from './contest-export.repository';
import { ContestExportService } from './contest-export.service';
import { ContestZipSweepService } from './contest-zip-sweep.service';

/** Builds contest submission exports: `<contestId>.export.zip` beside the data zips; sweeps both kinds once they expire. */
@Module({
  imports: [JobsModule.register(contestJobs.export)],
  providers: [
    ContestExportProcessor,
    ContestExportService,
    ContestExportRepository,
    ContestZipSweepService,
    { provide: CONTEST_EXPORT_LIMITS, useValue: DEFAULT_CONTEST_EXPORT_LIMITS },
  ],
})
export class ContestExportModule {}
