/** Principals and contest views shared by contest-access.spec.ts (rules) and contest-access.db.spec.ts (the Mongo filters). */
import type { Permission, Principal } from '@libs/auth';
import { newId } from '@libs/database';
import type { ContestAccessView } from '../src/modules/contests/core/contest-access';

export const USER = newId();
export const OTHER = newId();
export const ORG = newId();
export const NOW = new Date('2026-05-01T12:00:00Z');
export const hours = (count: number) =>
  new Date(NOW.getTime() + count * 3_600_000);
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
  overrides: Partial<ContestAccessView> = {},
): ContestAccessView => ({
  isVisible: true,
  isPrivate: false,
  isOrganizationPrivate: false,
  organizations: [],
  privateContestants: [],
  authors: [],
  curators: [],
  testers: [],
  viewContestScoreboard: [],
  balloonStaff: [],
  scoreboardVisibility: 'V',
  showSubmissionList: false,
  startTime: hours(-1),
  endTime: hours(2),
  timeLimit: null,
  frozenLastMinutes: 0,
  formatName: 'default',
  ...overrides,
});

export const PRINCIPALS: Record<string, Principal | null> = {
  anonymous: null,
  plain: principalWith(),
  member: principalWith({ organizationIds: [ORG] }),
  seePrivate: principalWith({}, 'judge.see_private_contest'),
  editAll: principalWith({}, 'judge.edit_all_contest'),
  editOwn: principalWith({}, 'judge.edit_own_contest'),
  superuser: principalWith({ isSuperuser: true }),
};
