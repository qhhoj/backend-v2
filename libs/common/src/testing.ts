export * from './mail/in-memory.mailer';
import { ModuleMetadata } from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { configureApp, fastifyAdapter } from './bootstrap';

export async function createTestApp(
  metadata: ModuleMetadata,
  {
    beforeInit,
    overrides = [],
  }: {
    beforeInit?: (app: NestFastifyApplication) => void;
    overrides?: Array<{ provide: unknown; useValue: unknown }>;
  } = {},
): Promise<NestFastifyApplication> {
  const builder = Test.createTestingModule(metadata);
  for (const { provide, useValue } of overrides)
    builder.overrideProvider(provide).useValue(useValue);
  const app = (
    await builder.compile()
  ).createNestApplication<NestFastifyApplication>(fastifyAdapter());
  await configureApp(app);
  beforeInit?.(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
export const TEST_REDIS_URL =
  process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/15';

export const TEST_ENV = {
  REDIS_URL: TEST_REDIS_URL,
  ENCRYPTION_KEY:
    '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
  TOKEN_SECRET: 'test-token-secret-test-token-secret',
  SITE_URL: 'http://localhost:5173',
  COOKIE_SECURE: 'false',
  PWNED_API_URL: '',
  LOG_LEVEL: 'silent',
  DISABLE_MONGODB_STREAM: 'true',
  SMTP_URL: 'smtp://127.0.0.1:2525',
};

/** Polls `condition` every 20 ms until it holds; throws after `timeoutMs`. */
export const waitUntil = async (
  condition: () => Promise<boolean> | boolean,
  timeoutMs = 5000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline)
      throw new Error(`Condition not met within ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};
