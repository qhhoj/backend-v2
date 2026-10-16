import { Module } from '@nestjs/common';
import { ContestSummaryCleanupService } from './contest-summary-cleanup.service';

@Module({ providers: [ContestSummaryCleanupService] })
export class ContestSummaryCleanupModule {}
