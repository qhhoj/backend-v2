import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ORGANIZATION_USAGE_AUDIT_QUEUE } from '@libs/community';
import { OrganizationUsageAuditProcessor } from './organization-usage-audit.processor';
import { OrganizationUsageAuditRepository } from './organization-usage-audit.repository';
import { OrganizationUsageAuditService } from './organization-usage-audit.service';

@Module({
  imports: [BullModule.registerQueue({ name: ORGANIZATION_USAGE_AUDIT_QUEUE })],
  providers: [
    OrganizationUsageAuditProcessor,
    OrganizationUsageAuditService,
    OrganizationUsageAuditRepository,
  ],
})
export class OrganizationUsageAuditModule {}
