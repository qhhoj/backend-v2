import type { Provider, Type } from '@nestjs/common';
import { OrganizationUsageController } from './organization-usage.controller';
import { OrganizationUsageRepository } from './organization-usage.repository';
import { OrganizationUsageService } from './organization-usage.service';

/** Controllers and providers of the organization usage dashboard, staff overview and quota edit. A lane adds its classes here, so `organizations-api.module.ts` is never edited by two lanes. */
export const ORGANIZATION_USAGE_CONTROLLERS: Type[] = [
  OrganizationUsageController,
];
export const ORGANIZATION_USAGE_PROVIDERS: Provider[] = [
  OrganizationUsageRepository,
  OrganizationUsageService,
];
