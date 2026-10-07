import type { Principal } from '@libs/auth';
import { newId } from '@libs/database';
import { OrganizationAccess } from './organization-access';

const principal = (fields: Partial<Principal> = {}): Principal => ({
  userId: newId(),
  username: 'viewer',
  isSuperuser: false,
  isStaff: false,
  permissions: new Set<string>(),
  organizationIds: [],
  ...fields,
});

describe('OrganizationAccess', () => {
  const listed = { id: newId(), isUnlisted: false, adminIds: [] as string[] };
  const unlisted = { id: newId(), isUnlisted: true, adminIds: [] as string[] };
  const member = principal({ organizationIds: [unlisted.id] });
  const admin = principal();
  const administered = { ...unlisted, adminIds: [admin.userId] };
  const editsAll = principal({
    permissions: new Set(['judge.edit_all_organization']),
  });
  const superuser = principal({ isSuperuser: true });

  it.each([
    ['anonymous', null, listed, true],
    ['anonymous', null, unlisted, false],
    ['an outsider', principal(), unlisted, false],
    ['a member', member, unlisted, true],
    ['an admin', admin, administered, true],
    ['edit_all_organization', editsAll, unlisted, true],
    ['a superuser', superuser, unlisted, true],
  ])(
    '%s sees the organization listed: %#',
    (_who, viewer, organization, expected) =>
      expect(OrganizationAccess.canList(viewer, organization)).toBe(expected),
  );

  it.each([
    ['anonymous', null, administered, false],
    ['a member', member, administered, false],
    ['an admin', admin, administered, true],
    ['edit_all_organization', editsAll, listed, true],
    [
      'organization_admin alone',
      principal({ permissions: new Set(['judge.organization_admin']) }),
      listed,
      false,
    ],
    ['a superuser', superuser, listed, true],
  ])(
    '%s administers the organization: %#',
    (_who, viewer, organization, expected) =>
      expect(OrganizationAccess.canAdminister(viewer, organization)).toBe(
        expected,
      ),
  );
});
