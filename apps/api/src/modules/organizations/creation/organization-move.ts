import { AppError, unique } from '@libs/common';

/** The organization rules of moving a problem or a contest between organizations, shared by both editors. */

/** A problem's or contest's organization fields, before or after an edit (ids as strings). */
export interface OrganizationScope {
  organizations: readonly string[];
  isOrganizationPrivate: boolean;
}

/** Issue code of a 403 on `organizations`: the editor lacks the organization creation rule (problems or contests) in an organization the change adds or removes. */
export const ORGANIZATION_RIGHTS_ISSUE = 'organization_rights';
/** Issue code of a 403 on `organizations`: leaving every organization for the site needs `judge.add_problem`. */
export const SITE_PROBLEM_RIGHTS_ISSUE = 'site_problem_rights';
/** Issue code of a 403 on `organizations`: leaving every organization for the site needs `judge.add_contest`. */
export const SITE_CONTEST_RIGHTS_ISSUE = 'site_contest_rights';

/** A 403 on `organizations` with one of the issue codes above. */
export const organizationRightsRefusal = (code: string, message: string) =>
  new AppError('forbidden', 403, message, undefined, undefined, {
    issues: [{ field: 'organizations', code, message }],
  });

const without = (ids: readonly string[], removed: readonly string[]) =>
  ids.filter((id) => !removed.includes(id));

/** An organization problem or contest: private to at least one organization (what visibility, metering and a problem's code prefix follow). */
export const isOrganizationScoped = (scope: OrganizationScope): boolean =>
  scope.isOrganizationPrivate && scope.organizations.length > 0;

/**
 * The organizations whose creation rights a change of the organization fields needs; empty when nothing changes.
 * Every added and every removed one; a flip to private needs all the listed ones (they all start to own it), a flip to
 * public all the ones it had (they all lose it); a new first organization (the one charged, whose prefix the code
 * carries) needs the old and the new first one, even when only the order changed.
 */
export function organizationsToAuthorize(
  before: OrganizationScope,
  after: OrganizationScope,
): string[] {
  const added = without(after.organizations, before.organizations);
  const removed = without(before.organizations, after.organizations);
  const flipped =
    before.isOrganizationPrivate === after.isOrganizationPrivate
      ? []
      : after.isOrganizationPrivate
        ? after.organizations
        : before.organizations;
  const [firstBefore, firstAfter] = [
    before.organizations[0],
    after.organizations[0],
  ];
  const reowned =
    firstBefore === firstAfter
      ? []
      : [firstBefore, firstAfter].filter(
          (id): id is string => id !== undefined,
        );
  return unique([...added, ...removed, ...flipped, ...reowned]);
}

/**
 * The change takes an organization-private problem or contest onto the site (needs the site create permission): it was
 * private to organizations and is no longer private to any. Keyed on the stored flag, so one private to no organization
 * (a staff leftover) cannot be made a site one either.
 */
export const leavesForSite = (
  before: OrganizationScope,
  after: OrganizationScope,
): boolean => before.isOrganizationPrivate && !isOrganizationScoped(after);
