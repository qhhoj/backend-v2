import { getModelToken } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseModule, Group } from '@libs/database';
import { startMongo } from '@libs/database/testing';
import { Model } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { GroupsModule } from './groups.module';
import { GroupsQuerier } from './groups.querier';

const waitFor = async (check: () => boolean, timeoutMs = 20000) => {
  for (
    const end = Date.now() + timeoutMs;
    !check();
    await new Promise((resolve) => setTimeout(resolve, 50))
  )
    if (Date.now() > end) throw new Error('timeout');
};

describe('GroupsQuerier', () => {
  const permissionsOf = (ids: string[]) =>
    querier.groupsOf(ids).flatMap((group) => group.permissions);
  let replSet: MongoMemoryReplSet,
    testingModule: TestingModule,
    groups: Model<Group>,
    querier: GroupsQuerier;
  let staffId: string;

  beforeAll(async () => {
    replSet = await startMongo();
    process.env.MONGO_URL = replSet.getUri('qhhoj');
    testingModule = await Test.createTestingModule({
      imports: [ScheduleModule.forRoot(), DatabaseModule, GroupsModule],
    }).compile();
    groups = testingModule.get(getModelToken(Group.name));
    staffId = (
      await groups.create({
        name: 'Staff',
        permissions: ['judge.edit_all_problem'],
      })
    )._id;
    await testingModule.init();
    querier = testingModule.get(GroupsQuerier);
  });
  afterAll(async () => {
    await testingModule.close();
    await replSet.stop();
  });

  it('applies inserts and updates from the change stream', async () => {
    const group = await groups.create({
      name: 'Org Admin',
      permissions: ['judge.edit_own_problem'],
    });
    await waitFor(() => permissionsOf([group._id]).length === 1);
    await groups.updateOne(
      { _id: group._id },
      { $push: { permissions: 'judge.clone_problem' } },
    );
    await waitFor(() => permissionsOf([group._id]).length === 2);
    expect(permissionsOf([staffId, group._id])).toEqual([
      'judge.edit_all_problem',
      'judge.edit_own_problem',
      'judge.clone_problem',
    ]);
  });

  it('keeps serving and recovers after resync', async () => {
    await groups.collection.updateOne(
      { name: 'Staff' },
      { $set: { permissions: [] } },
    );
    await querier.resync();
    expect(permissionsOf([staffId])).toEqual([]);
  });
});
