export interface ChargeSubject {
  isOrganizationPrivate?: boolean;
  organizations?: readonly string[];
}

/** The organization a creation or a write is charged to: the first listed one of an organization-private subject. Superusers and subjects with no organization are exempt (null). Shared by the api and the worker's Polygon sync. */
export function chargedOrganization(
  principal: { isSuperuser: boolean },
  subject: ChargeSubject,
): string | null {
  if (principal.isSuperuser || !subject.isOrganizationPrivate) return null;
  return subject.organizations?.[0] ?? null;
}
