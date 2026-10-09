import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { PACKAGE_QUEUE } from '@libs/problems';
import { DEFAULT_PACKAGE_LIMITS, PACKAGE_LIMITS } from './package-zip';
import { ProblemPackageProcessor } from './problem-package.processor';
import { ProblemPackageRepository } from './problem-package.repository';
import { ProblemPackageService } from './problem-package.service';

@Module({
  imports: [BullModule.registerQueue({ name: PACKAGE_QUEUE })],
  providers: [
    ProblemPackageProcessor,
    ProblemPackageService,
    ProblemPackageRepository,
    { provide: PACKAGE_LIMITS, useValue: DEFAULT_PACKAGE_LIMITS },
  ],
})
export class ProblemPackageModule {}
