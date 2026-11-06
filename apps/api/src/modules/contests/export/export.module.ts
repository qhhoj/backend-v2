import { Module } from '@nestjs/common';
import { JobsModule, RateLimitService } from '@libs/common';
import { contestJobs } from '@libs/contests';
import { ContestAccessModule } from '../core/contest-access.module';
import { ContestExportController } from './contest-export.controller';
import { ContestExportService } from './contest-export.service';

/** The contest submissions export (request, status, download). */
@Module({
  imports: [ContestAccessModule, JobsModule.register(contestJobs.export)],
  controllers: [ContestExportController],
  providers: [ContestExportService, RateLimitService],
})
export class ExportModule {}
