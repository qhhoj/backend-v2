import { getModelToken } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseModule, Group, newId, User } from '@libs/database';
import { startMongo } from '@libs/database/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Model } from 'mongoose';
import { GroupsModule } from '../groups/groups.module';
import { UsersRepository } from '../users/users.repository';
import { hasPermission } from './principal';
import { PrincipalService } from './principal.service';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('PrincipalService', () => {
  let replSet: MongoMemoryReplSet;
  let testingModule: TestingModule;
  let users: Model<User>;
  let principals: PrincipalService;
  let repository: UsersRepository;
  let staffGroupId: string;

  beforeAll(async () => {
    replSet = await startMongo();
    process.env.MONGO_URL = replSet.getUri('qhhoj');
    testingModule = await Test.createTestingModule({
      imports: [ScheduleModule.forRoot(), DatabaseModule, GroupsModule],
      providers: [PrincipalService, UsersRepository],
    }).compile();
    users = testingModule.get(getModelToken(User.name));
    staffGroupId = (
      await testingModule
        .get<Model<Group>>(getModelToken(Group.name))
        .create({ name: 'Staff', permissions: ['judge.edit_all_problem'] })
    )._id;
    await testingModule.init();
    principals = testingModule.get(PrincipalService);
    repository = testingModule.get(UsersRepository);
  });
  afterAll(async () => {
    await testingModule.close();
    await replSet.stop();
  });

  it('merges user and group permissions', async () => {
    const organizationId = newId();
    await users.create({
      username: 'Alice',
      password: 'x',
      groups: [staffGroupId],
      permissions: ['judge.rejudge_submission'],
      organizations: [organizationId],
    });
    const principal = principals.build(
      (await repository.findByUsername('alice'))!,
    );
    expect([...principal.permissions].sort()).toEqual([
      'judge.edit_all_problem',
      'judge.rejudge_submission',
    ]);
    expect(principal).toMatchObject({
      username: 'Alice',
      isSuperuser: false,
      organizationIds: [organizationId],
    });
    expect(principal.userId).toMatch(UUID_PATTERN);
    expect(principal.organizationIds[0]).toMatch(UUID_PATTERN);
    expect(hasPermission(principal, 'judge.edit_all_problem')).toBe(true);
    expect(hasPermission(principal, 'judge.lock_contest')).toBe(false);
  });
  it('grants superusers everything', async () => {
    const root = await users.create({
      username: 'root',
      password: 'x',
      isSuperuser: true,
    });
    expect(
      hasPermission(
        principals.build((await repository.findById(root._id))!),
        'judge.lock_contest',
      ),
    ).toBe(true);
  });
  it('returns null for malformed or unknown ids', async () => {
    expect(await repository.findById('not-a-uuid')).toBeNull();
    expect(await repository.findById('')).toBeNull();
    expect(await repository.findById(newId())).toBeNull();
  });
});
