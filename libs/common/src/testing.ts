import { ModuleMetadata } from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { configureApp, fastifyAdapter } from './bootstrap';

export async function createTestApp(
  metadata: ModuleMetadata,
  beforeInit?: (app: NestFastifyApplication) => void,
): Promise<NestFastifyApplication> {
  const app = (
    await Test.createTestingModule(metadata).compile()
  ).createNestApplication<NestFastifyApplication>(fastifyAdapter());
  await configureApp(app);
  beforeInit?.(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
export const TEST_REDIS_URL =
  process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/15';
