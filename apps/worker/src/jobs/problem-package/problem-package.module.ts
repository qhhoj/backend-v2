import { Module } from '@nestjs/common';
import { JobsModule } from '@libs/common';
import { problemJobs } from '@libs/problems';
import { ProblemPackageProcessor } from './problem-package.processor';
import { ProblemPackageRepository } from './problem-package.repository';
import { ProblemPackageService } from './problem-package.service';

@Module({
  imports: [JobsModule.register(problemJobs.package)],
  providers: [
    ProblemPackageProcessor,
    ProblemPackageService,
    ProblemPackageRepository,
  ],
})
export class ProblemPackageModule {}
