import type { Provider, Type } from '@nestjs/common';
import { OrganizationProblemsController } from './organization-problems.controller';
import { OrganizationProblemsRepository } from './organization-problems.repository';
import { OrganizationProblemsService } from './organization-problems.service';

/** Controllers and providers of the organization problem list, tags, archive and bulk. A lane adds its classes here, so `organizations-api.module.ts` is never edited by two lanes. */
export const ORGANIZATION_PROBLEM_CONTROLLERS: Type[] = [
  OrganizationProblemsController,
];
export const ORGANIZATION_PROBLEM_PROVIDERS: Provider[] = [
  OrganizationProblemsRepository,
  OrganizationProblemsService,
];
