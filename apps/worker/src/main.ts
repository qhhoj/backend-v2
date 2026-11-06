import { NestFactory } from '@nestjs/core';
import { createConnection } from 'mongoose';
import { loadEnv, nestLogLevels } from '@libs/common';
import { buildIndexes } from '@libs/database';
import { MigrationRunner } from './migrations/migration-runner.service';
import { MigrationsModule } from './migrations/migrations.module';
import { WorkerModule } from './worker.module';

async function bootstrap() {
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
  const { logLevel } = loadEnv();
  const app = await NestFactory.createApplicationContext(MigrationsModule, {
    logger: nestLogLevels(logLevel),
  });
  try {
    await app.get(MigrationRunner).runPending();
  } finally {
    await app.close();
  }
}

/** One-shot steps the deploy runs with the new image before the restart (`deploy/qhhoj-deploy`); a failure exits non-zero and stops the deploy. Their errors carry no row data (`indexBuildFailure`, `migrationFailure`), since the deploy log is public. */
const STEPS = new Map([
  ['indexes', indexes],
  ['migrate', migrate],
]);

const step = STEPS.get(process.argv[2] ?? '');
if (step)
  step().catch((error: Error) => {
    console.error(`${process.argv[2]}: ${error.message}`);
    process.exitCode = 1;
  });
else void bootstrap();
