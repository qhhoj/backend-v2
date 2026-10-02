import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { startMongo } from '@libs/database/testing';
import { readFileSync } from 'node:fs';
import { createConnection } from 'mysql2/promise';
import { Connection } from 'mongoose';
import { MigratorModule } from '../src/migrator.module';

export const TEST_SECRET = 'qhhoj-test-secret';
export const TEST_KEY =
  '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

export async function setupMigratorTest() {
  const base = process.env.TEST_MYSQL_URL ?? 'mysql://root:root@127.0.0.1:3306';
  const name = `legacy_${process.pid}_${Date.now()}`;
  const admin = await createConnection({ uri: base, multipleStatements: true });
  await admin.query(
    `CREATE DATABASE ${name}; USE ${name}; ${readFileSync('test/fixtures/legacy.sql', 'utf8')}`,
  );
  const replSet = await startMongo();
  Object.assign(process.env, {
    LEGACY_MYSQL_URL: `${base}/${name}`,
    MONGO_URL: replSet.getUri('qhhoj'),
    LEGACY_SECRET_KEY: TEST_SECRET,
    ENCRYPTION_KEY: TEST_KEY,
  });
  const testingModule = await Test.createTestingModule({
    imports: [MigratorModule],
  }).compile();
  await testingModule.init();
  const db = testingModule.get<Connection>(getConnectionToken()).db!;
  return {
    testingModule,
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
