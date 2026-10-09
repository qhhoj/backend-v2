import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CONTEST_EXPORT_QUEUE } from '@libs/contests';

/** Builds contest submission exports (the job's service and processor arrive with the job). */
@Module({ imports: [BullModule.registerQueue({ name: CONTEST_EXPORT_QUEUE })] })
export class ContestExportModule {}
