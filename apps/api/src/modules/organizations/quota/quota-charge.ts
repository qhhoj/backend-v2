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
