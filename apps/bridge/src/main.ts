import { NestFactory } from '@nestjs/core';
import { loadEnv, nestLogLevels } from '@libs/common';
import { BridgeModule } from './bridge.module';

async function bootstrap() {
  const { logLevel } = loadEnv();
  const app = await NestFactory.createApplicationContext(BridgeModule, {
    logger: nestLogLevels(logLevel),
  });
  app.enableShutdownHooks();
  await app.init();
}
void bootstrap();
