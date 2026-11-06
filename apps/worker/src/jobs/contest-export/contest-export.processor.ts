import { Injectable } from '@nestjs/common';
import { JobProcessor } from '@libs/common';
import { contestJobs } from '@libs/contests';
import type { ContestExportJob } from '@libs/contests';
import { ContestExportService } from './contest-export.service';
import { ContestZipSweepService } from './contest-zip-sweep.service';

@Injectable()
export class ContestExportProcessor extends JobProcessor<
  ContestExportJob,
  number
>(contestJobs.export, contestJobs.zipSweep) {
  constructor(
    private readonly exports: ContestExportService,
    private readonly zips: ContestZipSweepService,
  ) {
    super();
  }

  run(job: ContestExportJob): Promise<number> {
    return this.exports.prepare(job);
  }

  sweep(): Promise<number> {
    return this.zips.sweep();
  }
}
