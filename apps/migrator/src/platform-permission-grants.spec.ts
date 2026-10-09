import mongoose from 'mongoose';
import type { Connection } from 'mongoose';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { startMongo } from '@libs/database/testing';
import { GrantPermissionsService } from './grant-permissions.service';
import { PERMISSION_GRANTS } from './permission-grants';

describe('platform permission grants', () => {
  let replSet: MongoMemoryReplSet;
  let connection: Connection;
  const permissionsOf = async (name: string) =>
    (await connection.collection('groups').findOne({ name }))!
      .permissions as string[];

  beforeAll(async () => {
    replSet = await startMongo();
    connection = await mongoose.createConnection(replSet.getUri()).asPromise();
    await connection.collection('groups').insertMany([
      { name: 'site editors', permissions: ['flatpages.change_flatpage'] },
      { name: 'settings admins', permissions: ['judge.change_settings'] },
      { name: 'authors', permissions: ['judge.add_contest'] },
    ]);
    await new GrantPermissionsService(connection, PERMISSION_GRANTS).grant();
  });
  afterAll(async () => {
    await connection.close();
    await replSet.stop();
  });

  it('gives short-link management to site-content editors only', async () => {
    expect(await permissionsOf('site editors')).toContain(
      'judge.manage_short_link',
    );
    expect(await permissionsOf('settings admins')).not.toContain(
      'judge.manage_short_link',
    );
    expect(await permissionsOf('authors')).not.toContain(
      'judge.manage_short_link',
    );
  });

  it('gives integration management to settings administrators only', async () => {
    expect(await permissionsOf('settings admins')).toContain(
      'judge.manage_integration',
    );
    expect(await permissionsOf('site editors')).not.toContain(
      'judge.manage_integration',
    );
    expect(await permissionsOf('authors')).not.toContain(
      'judge.manage_integration',
    );
  });
});
