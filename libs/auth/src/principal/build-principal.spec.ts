import { buildPrincipal } from './build-principal';

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
