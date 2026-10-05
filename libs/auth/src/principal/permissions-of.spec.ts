import { permissionsOf } from './permissions-of';

describe('permissionsOf', () => {
  it('unions the user permissions with those of every group, without duplicates', () =>
    expect(
      permissionsOf(
        { permissions: ['judge.add_problem', 'judge.clone_problem'] },
        [
          { permissions: ['judge.clone_problem', 'judge.edit_all_problem'] },
          { permissions: ['judge.edit_own_problem'] },
        ],
      ),
    ).toEqual(
      new Set([
        'judge.add_problem',
        'judge.clone_problem',
        'judge.edit_all_problem',
        'judge.edit_own_problem',
      ]),
    ));
  it('is empty for a user with nothing and no groups', () =>
    expect(permissionsOf({ permissions: [] }, [])).toEqual(new Set()));
});
