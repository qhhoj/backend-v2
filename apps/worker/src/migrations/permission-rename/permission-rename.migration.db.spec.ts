import { Group, User } from '@libs/database';
import { setupMigrationsTest } from '../../../test/migrations-setup';
import type { MigrationsTest } from '../../../test/migrations-setup';
import { PermissionRenameMigration } from './permission-rename.migration';

const OLD = 'judge.import_polygon_package';
const NEW = 'judge.sync_polygon_problem';

describe('permission rename migration', () => {
  let test: MigrationsTest;

  beforeAll(async () => {
    test = await setupMigrationsTest();
  });
  afterAll(() => test.teardown());

  it('gives roles and users holding the import permission the sync permission instead, and a second run changes nothing', async () => {
    const groups = test.model<Group>(Group.name);
    const users = test.model<User>(User.name);
    await groups.create([
      { name: 'Setter', permissions: [OLD, 'judge.add_problem'] },
      { name: 'Both', permissions: [OLD, NEW] },
      { name: 'Other', permissions: ['judge.add_problem'] },
    ]);
    const user = await users.create({
      username: 'polysetter',
      password: '!',
      permissions: [OLD],
    });
    const migration = test.module.get(PermissionRenameMigration);
    const permissionsOf = async (name: string) =>
      [...(await groups.findOne({ name }).lean())!.permissions].sort();

    expect(await migration.run()).toBe(3);

    expect(await permissionsOf('Setter')).toEqual(['judge.add_problem', NEW]);
    expect(await permissionsOf('Both')).toEqual([NEW]);
    expect(await permissionsOf('Other')).toEqual(['judge.add_problem']);
    expect((await users.findById(user._id).lean())!.permissions).toEqual([NEW]);
    const after = await groups.find().sort({ _id: 1 }).lean();
    expect(await migration.run()).toBe(0);
    expect(await groups.find().sort({ _id: 1 }).lean()).toEqual(after);
  });
});
