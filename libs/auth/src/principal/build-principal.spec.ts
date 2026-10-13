import { buildPrincipal } from './build-principal';
import { hasPermission } from './principal';

const user = {
  _id: '0198a1b2-0000-7000-8000-000000000001',
  username: 'ana',
  isSuperuser: false,
  isStaff: true,
  permissions: ['judge.add_contest'],
  organizations: ['0198a1b2-0000-7000-8000-0000000000aa'],
};

describe('buildPrincipal', () => {
  it('merges direct and group permissions and carries identity fields', () => {
    const principal = buildPrincipal(user, [
      { permissions: ['judge.lock_contest'] },
      { permissions: ['judge.add_contest'] },
    ]);
    expect(principal).toEqual({
      userId: user._id,
      username: 'ana',
      isSuperuser: false,
      isStaff: true,
      permissions: new Set(['judge.add_contest', 'judge.lock_contest']),
      organizationIds: ['0198a1b2-0000-7000-8000-0000000000aa'],
    });
  });
});

describe('a stored codename outside the catalog', () => {
  it('grants nothing it does not name', () => {
    const principal = buildPrincipal(
      { ...user, permissions: ['judge.import_polygon_package'] },
      [{ permissions: ['judge.import_polygon_package'] }],
    );
    expect(hasPermission(principal, 'judge.sync_polygon_problem')).toBe(false);
    expect(hasPermission(principal, 'judge.add_problem')).toBe(false);
  });
});
