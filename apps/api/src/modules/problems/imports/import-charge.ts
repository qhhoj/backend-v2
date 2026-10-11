import type { Principal } from '@libs/auth';
import { chargedOrganization } from '../../organizations/quota/quota-charge';

/** The organization whose quota meters an import that creates a problem for `organizationId`: none for a site problem (null) or a superuser. */
export const meteredOrganizationOf = (
  principal: Pick<Principal, 'isSuperuser'>,
  organizationId: string | null,
): string | null =>
  organizationId === null
    ? null
    : chargedOrganization(principal, {
        isOrganizationPrivate: true,
        organizations: [organizationId],
      });
