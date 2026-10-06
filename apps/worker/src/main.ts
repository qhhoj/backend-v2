import { NestFactory } from '@nestjs/core';
import { loadEnv, nestLogLevels } from '@libs/common';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  const { logLevel } = loadEnv();
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: nestLogLevels(logLevel),
  });
  app.enableShutdownHooks();
  await app.init();
}
void bootstrap();
