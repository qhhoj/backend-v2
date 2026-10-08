import { encryptionKey } from '@libs/common';
import { createConnection } from 'mongoose';
import { assertSeedAllowed, seedE2e } from './seed-e2e';

async function main(): Promise<void> {
  assertSeedAllowed(process.env.NODE_ENV);
  const { MONGO_URL, PROBLEM_DATA_ROOT } = process.env;
  if (!MONGO_URL || !PROBLEM_DATA_ROOT)
    throw new Error('MONGO_URL and PROBLEM_DATA_ROOT are required');
  const key = encryptionKey(process.env.ENCRYPTION_KEY);
  const connection = await createConnection(MONGO_URL).asPromise();
  try {
    const summary = await seedE2e(connection, {
      problemDataRoot: PROBLEM_DATA_ROOT,
      adminPassword: process.env.E2E_ADMIN_PASSWORD ?? 'e2e-admin-pass-1',
      userPassword: process.env.E2E_USER_PASSWORD ?? 'e2e-user-pass-1',
      encryptionKey: key,
    });
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await connection.close();
  }
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
