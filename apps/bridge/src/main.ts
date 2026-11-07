import { NestFactory } from '@nestjs/core';
import { bridgeConfig, nestLogLevels } from '@libs/common';
import { BridgeModule } from './bridge.module';

async function bootstrap() {
  const { logLevel } = bridgeConfig.load();
  const app = await NestFactory.createApplicationContext(BridgeModule, {
    logger: nestLogLevels(logLevel),
  });
  app.enableShutdownHooks();
  await app.init();
}
void bootstrap();
