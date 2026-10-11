/** Principals and problem views shared by problem-access.spec.ts (rules) and problem-access.db.spec.ts (the Mongo filters). */
import type { Permission, Principal } from '@libs/auth';
import { newId } from '@libs/database';
import type { ProblemAccessView } from '../src/modules/problems/core/problem-access';

export const USER = newId();
export const OTHER = newId();
export const ORG = newId();
export const principalWith = (
  overrides: Partial<Principal> = {},
  ...permissions: Permission[]
): Principal => ({
  userId: USER,
  username: 'user',
  isSuperuser: false,
  isStaff: false,
  permissions: new Set(permissions),
  organizationIds: [],
  ...overrides,
});
export const view = (
  overrides: Partial<ProblemAccessView> = {},
): ProblemAccessView => ({
  id: 'p-own',
  isPublic: true,
  isOrganizationPrivate: false,
  organizations: [],
  authors: [],
  curators: [],
  testers: [],
  suggester: null,
  ...overrides,
});

export const PRINCIPALS: Record<string, Principal | null> = {
  anonymous: null,
  plain: principalWith(),
  orgMember: principalWith({ organizationIds: [ORG] }),
  seePrivate: principalWith({}, 'judge.see_private_problem'),
  seeOrg: principalWith({}, 'judge.see_organization_problem'),
  editOwn: principalWith({}, 'judge.edit_own_problem'),
  editAll: principalWith(
    {},
    'judge.edit_own_problem',
    'judge.edit_all_problem',
  ),
  editPublic: principalWith(
    {},
    'judge.edit_own_problem',
    'judge.edit_public_problem',
  ),
  editPublicWithoutOwn: principalWith({}, 'judge.edit_public_problem'),
  suggester: principalWith({}, 'judge.suggest_new_problem'),
  suggesterEditor: principalWith(
    {},
    'judge.edit_own_problem',
    'judge.suggest_new_problem',
  ),
  superuser: principalWith({ isSuperuser: true }),
};
