import { ModuleMetadata } from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { configureApp, fastifyAdapter } from './bootstrap';

export async function createTestApp(
  metadata: ModuleMetadata,
): Promise<NestFastifyApplication> {
  const app = (
    await Test.createTestingModule(metadata).compile()
  ).createNestApplication<NestFastifyApplication>(fastifyAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
