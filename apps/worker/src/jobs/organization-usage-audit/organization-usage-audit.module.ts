import { Module } from '@nestjs/common';
import { JobsModule } from '@libs/common';
import { communityJobs } from '@libs/community';
import { OrganizationUsageAuditProcessor } from './organization-usage-audit.processor';
import { OrganizationUsageAuditRepository } from './organization-usage-audit.repository';
import { OrganizationUsageAuditService } from './organization-usage-audit.service';

@Module({
  imports: [JobsModule.register(communityJobs.organizationUsageAudit)],
  providers: [
    OrganizationUsageAuditProcessor,
    OrganizationUsageAuditService,
    OrganizationUsageAuditRepository,
  ],
})
export class OrganizationUsageAuditModule {}
