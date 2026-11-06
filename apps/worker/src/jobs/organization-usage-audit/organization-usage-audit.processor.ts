import { Injectable } from '@nestjs/common';
import { JobProcessor } from '@libs/common';
import { communityJobs } from '@libs/community';
import { OrganizationUsageAuditService } from './organization-usage-audit.service';

@Injectable()
export class OrganizationUsageAuditProcessor extends JobProcessor<
  void,
  { checked: number; drifted: number }
>(communityJobs.organizationUsageAudit) {
  constructor(private readonly audits: OrganizationUsageAuditService) {
    super();
  }

  run() {
    return this.audits.audit();
  }
}
