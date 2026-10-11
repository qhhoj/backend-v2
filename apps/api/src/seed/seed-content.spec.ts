import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encryptionKey } from '@libs/common';
import { TEST_ENV } from '@libs/common/testing';
import { startMongo } from '@libs/database/testing';
import { createConnection } from 'mongoose';
import type { Connection } from 'mongoose';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { seedE2e } from './seed-e2e';

describe('seed:e2e content', () => {
  let replSet: MongoMemoryReplSet;
  let connection: Connection;
  let root: string;
  const options = () => ({
    problemDataRoot: root,
    adminPassword: 'a-long-admin-password',
    userPassword: 'a-long-user-password',
    encryptionKey: encryptionKey(TEST_ENV.ENCRYPTION_KEY),
    judgeName: 'e2e-judge',
    judgeKey: 'e2e-judge-key',
  });

  beforeAll(async () => {
    replSet = await startMongo();
    connection = await createConnection(replSet.getUri('qhhoj')).asPromise();
    root = mkdtempSync(join(tmpdir(), 'seed-content-'));
  });
  afterAll(async () => {
    await connection.close();
    await replSet.stop();
    rmSync(root, { recursive: true, force: true });
  });

  it('is idempotent: a second run changes no row and rewrites no file', async () => {
    await seedE2e(connection, options());
    const snapshot = async () =>
      JSON.stringify([
        await connection
          .collection('problems')
          .find()
          .sort({ code: 1 })
          .toArray(),
        await connection
          .collection('contests')
          .find()
          .sort({ key: 1 })
          .toArray(),
        await connection.collection('users').countDocuments(),
        await connection.collection('judges').countDocuments(),
      ]);
    const zipPath = join(root, 'e2e_max', 'tests.zip');
    const before = { rows: await snapshot(), zip: readFileSync(zipPath) };
    await seedE2e(connection, options());
    expect(await snapshot()).toBe(before.rows);
    expect(readFileSync(zipPath).equals(before.zip)).toBe(true);
  });
});
