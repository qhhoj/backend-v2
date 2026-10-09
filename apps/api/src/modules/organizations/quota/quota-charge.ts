export interface ChargeSubject {
  isOrganizationPrivate?: boolean;
  organizations?: readonly string[];
}

/** The organization a creation is charged to: the first listed one of an organization-private subject. Superusers and subjects with no organization are exempt (null). */
export function chargedOrganization(
  principal: { isSuperuser: boolean },
  subject: ChargeSubject,
): string | null {
  if (principal.isSuperuser || !subject.isOrganizationPrivate) return null;
  return subject.organizations?.[0] ?? null;
}

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
