import { effectivePermissions, unknownAdded } from './access-rules';

describe('access rules', () => {
  it('lets a held legacy codename stay but never adds an unknown one', () => {
    expect(
      unknownAdded(
        ['judge.legacy_perm', 'judge.made_up', 'judge.ban_user'],
        ['judge.legacy_perm'],
      ),
    ).toEqual(['judge.made_up']);
  });

  it('marks each permission as direct and names the roles granting it', () => {
    expect(
      effectivePermissions(
        ['judge.ban_user'],
        [
          {
            name: 'Mods',
            permissions: ['judge.ban_user', 'judge.change_comment'],
          },
          { name: 'Editors', permissions: ['judge.change_comment'] },
        ],
      ),
    ).toEqual([
      { codename: 'judge.ban_user', direct: true, viaGroups: ['Mods'] },
      {
        codename: 'judge.change_comment',
        direct: false,
        viaGroups: ['Mods', 'Editors'],
      },
    ]);
  });
});
