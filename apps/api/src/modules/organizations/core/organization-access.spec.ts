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

  describe('creating for the organization', () => {
    const withRights = (fields: Partial<Principal> = {}) =>
      principal({
        permissions: new Set([
          'judge.create_organization_problem',
          'judge.create_private_contest',
        ]),
        ...fields,
      });
    const teacher = withRights();
    const ownOrganization = { ...listed, adminIds: [teacher.userId] };

    it.each([
      ['anonymous', null, false],
      ['an admin holding the permissions', teacher, true],
      ['an admin without them', admin, false],
      [
        'a member holding them',
        withRights({ organizationIds: [listed.id] }),
        false,
      ],
      [
        'edit_all_organization holding them',
        withRights({
          permissions: new Set([
            'judge.edit_all_organization',
            'judge.create_organization_problem',
            'judge.create_private_contest',
          ]),
        }),
        true,
      ],
      ['a superuser', superuser, true],
    ])('%s may create problems and contests: %#', (_who, viewer, expected) => {
      const organization =
        viewer === admin
          ? { ...listed, adminIds: [admin.userId] }
          : ownOrganization;
      expect(OrganizationAccess.canCreateProblem(viewer, organization)).toBe(
        expected,
      );
      expect(OrganizationAccess.canCreateContest(viewer, organization)).toBe(
        expected,
      );
    });

    it('needs each kind of permission for its own kind', () => {
      const problemsOnly = principal({
        permissions: new Set(['judge.create_organization_problem']),
      });
      const organization = { ...listed, adminIds: [problemsOnly.userId] };
      expect(
        OrganizationAccess.canCreateProblem(problemsOnly, organization),
      ).toBe(true);
      expect(
        OrganizationAccess.canCreateContest(problemsOnly, organization),
      ).toBe(false);
    });
  });
});
