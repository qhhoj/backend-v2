import type { Provider, Type } from '@nestjs/common';
import { ArchiveNoticeController } from './archive-notice.controller';
import { ArchiveNoticeService } from './archive-notice.service';
import { OrganizationProblemBulkController } from './organization-problem-bulk.controller';
import { OrganizationProblemBulkService } from './organization-problem-bulk.service';
import { OrganizationProblemsController } from './organization-problems.controller';
import { OrganizationProblemsRepository } from './organization-problems.repository';
import { OrganizationProblemsService } from './organization-problems.service';

/** Controllers and providers of the organization problem list, tags, archive, bulk actions and archive notice. A lane adds its classes here, so `organizations-api.module.ts` is never edited by two lanes. */
export const ORGANIZATION_PROBLEM_CONTROLLERS: Type[] = [
  OrganizationProblemsController,
  OrganizationProblemBulkController,
  ArchiveNoticeController,
];
export const ORGANIZATION_PROBLEM_PROVIDERS: Provider[] = [
  OrganizationProblemsRepository,
  OrganizationProblemsService,
  OrganizationProblemBulkService,
  ArchiveNoticeService,
];
