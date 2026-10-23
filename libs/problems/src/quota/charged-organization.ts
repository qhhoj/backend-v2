export interface ChargeSubject {
  isOrganizationPrivate?: boolean;
  organizations?: readonly string[];
}

/** The organization that owns a subject: the first listed one of an organization-private subject, else null (a site subject or one with no organization). Whoever acts, so judging time is charged to it even for a superuser's submission. */
export function ownerOrganization(subject: ChargeSubject): string | null {
  if (!subject.isOrganizationPrivate) return null;
  return subject.organizations?.[0] ?? null;
}

/** The organization a creation or a write is charged to: the owner (`ownerOrganization`), except that superusers are exempt (null). Shared by the api and the worker's Polygon sync. */
export function chargedOrganization(
  principal: { isSuperuser: boolean },
  subject: ChargeSubject,
): string | null {
  return principal.isSuperuser ? null : ownerOrganization(subject);
}
