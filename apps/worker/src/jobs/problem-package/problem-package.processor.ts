import { Injectable } from '@nestjs/common';
import { JobFailure, JobProcessor } from '@libs/common';
import { PACKAGE_TOO_LARGE, problemJobs } from '@libs/problems';
import type { ProblemPackageJob } from '@libs/problems';
import { PackageTooLargeError } from './package-zip';
import { ProblemPackageService } from './problem-package.service';

@Injectable()
export class ProblemPackageProcessor extends JobProcessor<
  ProblemPackageJob,
  string
>(problemJobs.package, problemJobs.packageSweep) {
  constructor(private readonly packages: ProblemPackageService) {
    super();
  }

  /** An over-cap build fails with the failure the api maps to `409 package_too_large`; every other failure keeps its message in the log only. */
  async run(job: ProblemPackageJob): Promise<string> {
    try {
      return await this.packages.build(job);
    } catch (error) {
      if (error instanceof PackageTooLargeError)
        throw new JobFailure(PACKAGE_TOO_LARGE);
      throw error;
    }
  }

  sweep(): Promise<number> {
    return this.packages.sweep();
  }
}
