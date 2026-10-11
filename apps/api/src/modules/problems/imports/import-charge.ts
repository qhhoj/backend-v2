import type { Principal } from '@libs/auth';
import type { PolygonImportJob } from '@libs/problems';
import { chargedOrganization } from '../../organizations/quota/quota-charge';

/** The organization a Polygon import is charged to: the one a create names; null for an update, a site problem or a superuser. */
export const chargedOrganizationOf = (
  principal: Pick<Principal, 'isSuperuser'>,
  job: Pick<PolygonImportJob, 'mode' | 'organizationId'>,
): string | null =>
  job.mode === 'create' && job.organizationId
    ? chargedOrganization(principal, {
        isOrganizationPrivate: true,
        organizations: [job.organizationId],
      })
    : null;
