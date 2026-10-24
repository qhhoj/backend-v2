import { NestFactory } from '@nestjs/core';
import { createConnection } from 'mongoose';
import { loadEnv, nestLogLevels } from '@libs/common';
import { buildIndexes } from '@libs/database';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  const { logLevel } = loadEnv();
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: nestLogLevels(logLevel),
  });
  app.enableShutdownHooks();
  await app.init();
}

/** `indexes`: the deploy's index step (`deploy/qhhoj-deploy`); exits non-zero when a build fails. */
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

if (process.argv[2] === 'indexes')
  indexes().catch((error: Error) => {
    // A build failure is already reduced to collection, index and code (`indexBuildFailure`); the rest are connection errors, which quote no row.
    console.error(`indexes: ${error.message}`);
    process.exitCode = 1;
  });
else void bootstrap();
