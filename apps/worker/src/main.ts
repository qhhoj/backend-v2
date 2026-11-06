import { NestFactory } from '@nestjs/core';
import { createConnection } from 'mongoose';
import { loadEnv, nestLogLevels } from '@libs/common';
import { buildIndexes } from '@libs/database';
import { MigrationRunner } from './migrations/migration-runner.service';
import { MigrationsModule } from './migrations/migrations.module';
import { WorkerModule } from './worker.module';

const EX_USAGE = 64;

/** Boots `MigrationsModule` (data access only) around one use of the runner. */
async function withMigrationRunner<T>(
  use: (runner: MigrationRunner) => Promise<T>,
): Promise<T> {
  const { logLevel } = loadEnv();
  const app = await NestFactory.createApplicationContext(MigrationsModule, {
    logger: nestLogLevels(logLevel),
  });
  try {
    return await use(app.get(MigrationRunner));
  } finally {
    await app.close();
  }
}

/** The worker refuses to start while a migration is pending: it never serves data `worker migrate` has not brought up to date. */
async function bootstrap() {
  await withMigrationRunner((runner) => runner.assertNonePending());
  const { logLevel } = loadEnv();
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: nestLogLevels(logLevel),
  });
  app.enableShutdownHooks();
  await app.init();
}

async function indexes() {
  const connection = await createConnection(process.env.MONGO_URL ?? '', {
    autoIndex: false,
  }).asPromise();
  try {
    await buildIndexes(connection);
  } finally {
    await connection.close();
  }
}

async function migrate() {
  await withMigrationRunner((runner) => runner.runPending());
}

/** One-shot steps the deploy runs with the new image before the restart (`deploy/qhhoj-deploy`); a failure exits non-zero and stops the deploy. Their errors carry no row data or path (`indexBuildFailure`, `migrationFailure`), since the deploy log is public. Also listed in the Containerfile's `org.qhhoj.deploy-steps` label. */
const STEPS = new Map([
  ['indexes', indexes],
  ['migrate', migrate],
]);

/** Fails closed: an unknown step exits 64 at once, so a typo or a step this image predates never boots a worker. */
function main(arg: string | undefined) {
  const run = arg === undefined ? bootstrap : STEPS.get(arg);
  if (!run) {
    console.error(`unknown worker step: ${arg}`);
    process.exitCode = EX_USAGE;
    return;
  }
  run().catch((error: Error) => {
    // A step's log is the public deploy log: its message only. The worker's own goes to the journal whole.
    console.error(arg === undefined ? error : `${arg}: ${error.message}`);
    process.exit(1);
  });
}

main(process.argv[2]);
