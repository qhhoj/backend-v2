import { Module } from '@nestjs/common';
import { JobsModule } from '@libs/common';
import { problemJobs } from '@libs/problems';
import { DEFAULT_PACKAGE_LIMITS, PACKAGE_LIMITS } from './package-zip';
import { ProblemPackageProcessor } from './problem-package.processor';
import { ProblemPackageRepository } from './problem-package.repository';
import { ProblemPackageService } from './problem-package.service';

@Module({
  imports: [JobsModule.register(problemJobs.package)],
  providers: [
    ProblemPackageProcessor,
    ProblemPackageService,
    ProblemPackageRepository,
    { provide: PACKAGE_LIMITS, useValue: DEFAULT_PACKAGE_LIMITS },
  ],
})
export class ProblemPackageModule {}
