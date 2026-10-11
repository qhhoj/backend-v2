import type { Provider, Type } from '@nestjs/common';
import { OrganizationSubmissionsController } from './organization-submissions.controller';
import { OrganizationSubmissionsService } from './organization-submissions.service';

/** Controllers and providers of the organization submissions tab. */
export const ORGANIZATION_SUBMISSION_CONTROLLERS: Type[] = [
  OrganizationSubmissionsController,
];
export const ORGANIZATION_SUBMISSION_PROVIDERS: Provider[] = [
  OrganizationSubmissionsService,
];
