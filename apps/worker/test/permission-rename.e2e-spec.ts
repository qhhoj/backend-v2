import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Group } from '@libs/database';
import { PermissionRenameService } from '../src/jobs/permission-rename/permission-rename.service';
import { setupWorkerTest } from './setup';
import type { WorkerTest } from './setup';

const OLD = 'judge.import_polygon_package';
const NEW = 'judge.sync_polygon_problem';

describe('permission rename', () => {
  let worker: WorkerTest;
  let groups: Model<Group>;
  let renames: PermissionRenameService;

  beforeAll(async () => {
    worker = await setupWorkerTest();
    groups = worker.module.get(getModelToken(Group.name));
    renames = worker.module.get(PermissionRenameService);
  });
  afterAll(() => worker.teardown());

  const permissionsOf = async (name: string) =>
    [...(await groups.findOne({ name }).lean())!.permissions].sort();

  it('gives roles and users holding the import permission the sync permission instead, once', async () => {
    await groups.create([
      { name: 'Setter', permissions: [OLD, 'judge.add_problem'] },
      { name: 'Both', permissions: [OLD, NEW] },
      { name: 'Other', permissions: ['judge.add_problem'] },
    ]);
    const user = await worker.users.create({
      username: 'polysetter',
      password: '!',
      permissions: [OLD],
    });

    expect(await renames.rename({ from: OLD, to: NEW })).toBe(3);

    expect(await permissionsOf('Setter')).toEqual(['judge.add_problem', NEW]);
    expect(await permissionsOf('Both')).toEqual([NEW]);
    expect(await permissionsOf('Other')).toEqual(['judge.add_problem']);
    expect((await worker.users.findById(user._id).lean())!.permissions).toEqual(
      [NEW],
    );
    expect(await renames.rename({ from: OLD, to: NEW })).toBe(0);
  });
});
