import { NestFactory } from '@nestjs/core';
import { loadEnv } from '@libs/common';
import { nestLogLevels } from './log-levels';
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
