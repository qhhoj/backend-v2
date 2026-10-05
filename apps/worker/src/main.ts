import { NestFactory } from '@nestjs/core';
import { loadEnv } from '@libs/common';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  loadEnv();
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  await app.init();
}
void bootstrap();
