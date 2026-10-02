import { getModelToken } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseModule, Group } from '@libs/database';
import { startMongo } from '@libs/database/testing';
import { Model } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { GroupsModule } from './groups.module';
import { GroupsQuerier } from './groups.querier';

const waitFor = async (check: () => boolean, ms = 5000) => {
  for (
    const end = Date.now() + ms;
    !check();
    await new Promise((r) => setTimeout(r, 50))
  )
    if (Date.now() > end) throw new Error('timeout');
};

describe('GroupsQuerier', () => {
  let rs: MongoMemoryReplSet,
    mod: TestingModule,
    groups: Model<Group>,
    q: GroupsQuerier;
  let staffId: string;

  beforeAll(async () => {
    rs = await startMongo();
    process.env.MONGO_URL = rs.getUri('qhhoj');
    mod = await Test.createTestingModule({
      imports: [ScheduleModule.forRoot(), DatabaseModule, GroupsModule],
    }).compile();
    groups = mod.get(getModelToken(Group.name));
    staffId = (
      await groups.create({
        name: 'Staff',
        permissions: ['judge.edit_all_problem'],
      })
    )._id;
    await mod.init();
    q = mod.get(GroupsQuerier);
  });
  afterAll(async () => {
    await mod.close();
    await rs.stop();
  });

  it('loads existing groups on init', () =>
    expect(q.permissionsOf([staffId])).toEqual(['judge.edit_all_problem']));

  it('applies inserts and updates from the change stream', async () => {
    const g = await groups.create({
      name: 'Org Admin',
      permissions: ['judge.edit_own_problem'],
    });
    await waitFor(() => q.permissionsOf([g._id]).length === 1);
    await groups.updateOne(
      { _id: g._id },
      { $push: { permissions: 'judge.clone_problem' } },
    );
    await waitFor(() => q.permissionsOf([g._id]).length === 2);
    expect(q.permissionsOf([staffId, g._id])).toEqual([
      'judge.edit_all_problem',
      'judge.edit_own_problem',
      'judge.clone_problem',
    ]);
  });

  it('ignores unknown ids', () =>
    expect(q.permissionsOf(['00000000-0000-7000-8000-000000000000'])).toEqual(
      [],
    ));

  it('keeps serving and recovers after resync', async () => {
    await groups.collection.updateOne(
      { name: 'Staff' },
      { $set: { permissions: [] } },
    );
    await q.resync();
    expect(q.permissionsOf([staffId])).toEqual([]);
  });
});
