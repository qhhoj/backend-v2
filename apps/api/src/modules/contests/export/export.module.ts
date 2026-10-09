import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CONTEST_EXPORT_QUEUE } from '@libs/contests';
import { ContestAccessModule } from '../core/contest-access.module';

/** The contest submissions export (request, status, download). */
@Module({
  imports: [
    ContestAccessModule,
    BullModule.registerQueue({ name: CONTEST_EXPORT_QUEUE }),
  ],
})
export class ExportModule {}
