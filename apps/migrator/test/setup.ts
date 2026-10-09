import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { startMongo } from '@libs/database/testing';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createConnection } from 'mysql2/promise';
import { UUID } from 'mongodb';
import { Connection } from 'mongoose';
import { toUuid } from '@libs/database';
import { IdMapRepository } from '../src/id-map.repository';
import { MigratorModule } from '../src/migrator.module';

const FIXTURES = 'test/fixtures';
/** The schema dump plus every lane's synthetic rows (`legacy-<area>.sql`, ids in the lane's range). */
const fixtureSql = () =>
  [
    'legacy.sql',
    ...readdirSync(FIXTURES)
      .filter((name) => /^legacy-.+\.sql$/.test(name))
      .sort(),
  ]
    .map((name) => readFileSync(join(FIXTURES, name), 'utf8'))
    .join('\n');

export const TEST_SECRET = 'qhhoj-test-secret';
export const TEST_KEY =
  '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

export async function setupMigratorTest() {
  const base = process.env.TEST_MYSQL_URL ?? 'mysql://root:root@127.0.0.1:3306';
  const name = `legacy_${process.pid}_${Date.now()}`;
  const admin = await createConnection({ uri: base, multipleStatements: true });
  await admin.query(
    `CREATE DATABASE ${name}; USE ${name}; ${fixtureSql()}\n SET SESSION sql_mode = '';`,
  );
  const replSet = await startMongo();
  Object.assign(process.env, {
    LEGACY_MYSQL_URL: `${base}/${name}`,
    MONGO_URL: replSet.getUri('qhhoj'),
    LEGACY_SECRET_KEY: TEST_SECRET,
    ENCRYPTION_KEY: TEST_KEY,
    MEDIA_URL: '/media',
  });
  const testingModule = await Test.createTestingModule({
    imports: [MigratorModule],
  }).compile();
  testingModule.useLogger(false);
  await testingModule.init();
  const db = testingModule.get<Connection>(getConnectionToken()).db!;
  const uuidOf = async (table: string, legacyId: number) => {
    const ids = testingModule.get(IdMapRepository);
    await ids.load([table]);
    return toUuid(ids.get(table, legacyId));
  };
  const docOf = async (collection: string, table: string, legacyId: number) =>
    db
      .collection<{ _id: UUID }>(collection)
      .findOne({ _id: await uuidOf(table, legacyId) });
  return {
    testingModule,
    uuidOf,
    docOf,
    db,
    mysql: admin,
    name,
    teardown: async () => {
      await testingModule.close();
      await admin.query(`DROP DATABASE ${name}`);
      await admin.end();
      await replSet.stop();
    },
  };
}
