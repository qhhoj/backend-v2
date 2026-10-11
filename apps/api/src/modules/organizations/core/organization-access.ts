import { hasPermission } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { uuidStr } from '@libs/database';
import type { Organization } from '@libs/database';
import type { FilterQuery } from 'mongoose';

export interface OrganizationAccessView {
  id: string;
  isUnlisted: boolean;
  adminIds: string[];
}

/** Plain-string view (UUID arrays on hydrated documents are buffers under `.map`). */
const accessView = (organization: Organization): OrganizationAccessView => ({
  id: uuidStr(organization._id),
  isUnlisted: organization.isUnlisted,
  adminIds: organization.adminIds.map(uuidStr),
});

const editsAll = (principal: Principal | null) =>
  principal !== null && hasPermission(principal, 'judge.edit_all_organization');
const isMember = (principal: Principal | null, organizationId: string) =>
  principal !== null && principal.organizationIds.includes(organizationId);
/** Legacy `Organization.is_admin`. */
const isAdmin = (
  principal: Principal | null,
  organization: OrganizationAccessView,
) => principal !== null && organization.adminIds.includes(principal.userId);
/** Legacy `can_edit_organization`; `edit_all_organization` also decides join requests here (legacy ignored it there). */
const canAdminister = (
  principal: Principal | null,
  organization: OrganizationAccessView,
) => isAdmin(principal, organization) || editsAll(principal);
/** Legacy organization `problem-create` view: an administrator who also holds `create_organization_problem` (the `Org Admin` role carries it). */
const canCreateProblem = (
  principal: Principal | null,
  organization: OrganizationAccessView,
) =>
  principal !== null &&
  canAdminister(principal, organization) &&
  hasPermission(principal, 'judge.create_organization_problem');
/** Legacy organization `contest-create` view: an administrator who also holds `create_private_contest`. */
const canCreateContest = (
  principal: Principal | null,
  organization: OrganizationAccessView,
) =>
  principal !== null &&
  canAdminister(principal, organization) &&
  hasPermission(principal, 'judge.create_private_contest');
/** Who may see the organization enumerated (lists, user pages, leaderboards): unlisted ones only their members and `edit_all_organization` (legacy leaked them through select2 and the sitemap). Its own page stays reachable by slug for anyone: unlisted is not private. */
const canList = (
  principal: Principal | null,
  organization: OrganizationAccessView,
) =>
  !organization.isUnlisted ||
  isMember(principal, organization.id) ||
  canAdminister(principal, organization);

/** Mongo filter with `canList`'s semantics (an admin counts even when not a member). */
const listFilter = (principal: Principal | null): FilterQuery<Organization> =>
  editsAll(principal)
    ? {}
    : {
        $or: [
          { isUnlisted: false },
          ...(principal
            ? [
                { _id: { $in: principal.organizationIds } },
                { adminIds: principal.userId },
              ]
            : []),
        ],
      };

/** Mongo filter with `canAdminister`'s semantics; null administers nothing (anonymous), `{}` everything. */
const administeredFilter = (
  principal: Principal | null,
): FilterQuery<Organization> | null => {
  if (!principal) return null;
  return editsAll(principal) ? {} : { adminIds: principal.userId };
};

export const OrganizationAccess = {
  accessView,
  isMember,
  isAdmin,
  canAdminister,
  canCreateProblem,
  canCreateContest,
  canList,
  listFilter,
  administeredFilter,
};
