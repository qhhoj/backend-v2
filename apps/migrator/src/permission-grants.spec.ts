import { withoutGrantedPermissions } from './permission-grants';

describe('withoutGrantedPermissions', () => {
  it('drops a granted codename from a holder of its anchor', () => {
    expect(
      withoutGrantedPermissions({
        permissions: ['judge.edit_all_problem', 'judge.delete_problem'],
      }),
    ).toEqual({ permissions: ['judge.edit_all_problem'] });
  });

  it('keeps a granted codename on a holder without its anchor, so drift is still caught', () => {
    expect(
      withoutGrantedPermissions({ permissions: ['judge.delete_problem'] }),
    ).toEqual({ permissions: ['judge.delete_problem'] });
  });

  it('leaves a document without permissions alone', () => {
    expect(withoutGrantedPermissions({ name: 'x' })).toEqual({ name: 'x' });
  });
});
