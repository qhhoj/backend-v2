import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { User, UserSchema } from '@libs/database';
import { createConnection } from 'mongoose';
import { assertSeedAllowed } from './seed-e2e';
import { seedParity } from './seed-parity';

/** `npm run seed:parity`: the parity problems on a stack, and `$RUN/parity-manifest.json` for submit-all. */
async function main(): Promise<void> {
  assertSeedAllowed(process.env.NODE_ENV);
  const { MONGO_URL, PROBLEM_DATA_ROOT, RUN } = process.env;
  if (!MONGO_URL || !PROBLEM_DATA_ROOT || !RUN)
    throw new Error(
      'MONGO_URL, PROBLEM_DATA_ROOT and RUN are required (source $RUN/env)',
    );
  const connection = await createConnection(MONGO_URL).asPromise();
  try {
    const admin = await connection
      .model<User>(User.name, UserSchema)
      .findOne({ username: 'e2e_admin' })
      .orFail();
    const manifest = await seedParity(connection, {
      problemDataRoot: PROBLEM_DATA_ROOT,
      authorId: admin._id,
    });
    writeFileSync(
      join(RUN, 'parity-manifest.json'),
      JSON.stringify(manifest, null, 2),
    );
    console.log(
      `${manifest.runs.length} parity runs written to ${RUN}/parity-manifest.json`,
    );
  } finally {
    await connection.close();
  }
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
