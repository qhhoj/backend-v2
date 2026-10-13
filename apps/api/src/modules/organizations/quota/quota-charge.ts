import { chargedOrganization } from '@libs/problems';
import type { ChargeSubject } from '@libs/problems';

export { chargedOrganization };
export type { ChargeSubject };

/** The organization an edit newly scopes a contest or problem to: the one the edited subject is charged to, if the stored subject was not charged to any (public, or no organization). A subject that already had a charged organization is never charged again. */
export function newlyChargedOrganization(
  principal: { isSuperuser: boolean },
  stored: ChargeSubject,
  fields: ChargeSubject,
): string | null {
  if (chargedOrganization(principal, stored) !== null) return null;
  return chargedOrganization(principal, {
    isOrganizationPrivate:
      fields.isOrganizationPrivate ?? stored.isOrganizationPrivate,
    organizations: fields.organizations ?? stored.organizations,
  });
}
