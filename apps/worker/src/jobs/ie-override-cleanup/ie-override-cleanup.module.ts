import { Module } from '@nestjs/common';
import { IeOverrideCleanupService } from './ie-override-cleanup.service';

@Module({ providers: [IeOverrideCleanupService] })
export class IeOverrideCleanupModule {}
