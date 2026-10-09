import mongoose from 'mongoose';
import type { Connection } from 'mongoose';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { startMongo } from '@libs/database/testing';
import { GrantPermissionsService } from './grant-permissions.service';
import type { PermissionGrant } from './permission-grants';

describe('GrantPermissionsService', () => {
  let replSet: MongoMemoryReplSet;
  let connection: Connection;
  const grants: readonly PermissionGrant[] = [
    {
      permission: 'judge.change_contest_tag',
      heldBy: 'judge.edit_all_contest',
    },
  ];
  const permissionsOf = async (name: string): Promise<string[]> => {
    const group = await connection.collection('groups').findOne({ name });
    return group!.permissions as string[];
  };

  beforeAll(async () => {
    replSet = await startMongo();
    connection = await mongoose.createConnection(replSet.getUri()).asPromise();
  });
  afterAll(async () => {
    await connection.close();
    await replSet.stop();
  });
  beforeEach(async () => {
    const groups = connection.collection('groups');
    await groups.deleteMany({});
    await groups.insertMany([
      { name: 'admins', permissions: ['judge.edit_all_contest'] },
      { name: 'authors', permissions: ['judge.add_contest'] },
      {
        name: 'already',
        permissions: ['judge.edit_all_contest', 'judge.change_contest_tag'],
      },
    ]);
  });

  it('gives the new codename to the groups holding its anchor and to no other', async () => {
    const changed = await new GrantPermissionsService(
      connection,
      grants,
    ).grant();
    expect(changed).toEqual({ 'judge.change_contest_tag': 1 });
    expect(await permissionsOf('admins')).toEqual([
      'judge.edit_all_contest',
      'judge.change_contest_tag',
    ]);
    expect(await permissionsOf('authors')).toEqual(['judge.add_contest']);
  });

  it('changes nothing the second time and never duplicates a codename', async () => {
    const service = new GrantPermissionsService(connection, grants);
    await service.grant();
    expect(await service.grant()).toEqual({ 'judge.change_contest_tag': 0 });
    expect(await permissionsOf('already')).toEqual([
      'judge.edit_all_contest',
      'judge.change_contest_tag',
    ]);
  });
});
