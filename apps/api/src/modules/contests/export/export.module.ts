import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CONTEST_EXPORT_QUEUE } from '@libs/contests';
import { ContestAccessModule } from '../core/contest-access.module';
import { ContestExportController } from './contest-export.controller';
import { ContestExportService } from './contest-export.service';

/** The contest submissions export (request, status, download). */
@Module({
  imports: [
    ContestAccessModule,
    BullModule.registerQueue({ name: CONTEST_EXPORT_QUEUE }),
  ],
  controllers: [ContestExportController],
  providers: [ContestExportService],
})
export class ExportModule {}
