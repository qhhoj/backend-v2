import { unique } from '@libs/common';

/** A problem's organization fields, before or after an edit (ids as strings). */
export interface OrganizationScope {
  organizations: readonly string[];
  isOrganizationPrivate: boolean;
}

/** Issue code of a 403 on `organizations`: the editor lacks the organization creation rule in an organization the change adds or removes. */
export const ORGANIZATION_RIGHTS_ISSUE = 'organization_rights';
/** Issue code of a 403 on `organizations`: leaving every organization for the site needs `judge.add_problem`. */
export const SITE_PROBLEM_RIGHTS_ISSUE = 'site_problem_rights';

const without = (ids: readonly string[], removed: readonly string[]) =>
  ids.filter((id) => !removed.includes(id));

/** An organization problem: private to at least one organization (what visibility, metering and the code prefix follow). */
export const isOrganizationProblem = (scope: OrganizationScope): boolean =>
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

/** The change takes an organization problem out of every organization onto the site (`judge.add_problem`, like a site create). */
export const leavesForSite = (
  before: OrganizationScope,
  after: OrganizationScope,
): boolean => isOrganizationProblem(before) && !isOrganizationProblem(after);
