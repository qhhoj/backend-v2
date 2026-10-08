import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ENV } from './env';
import type { Env } from './env';
import { EnvModule } from './env.module';
import { validEnv } from './env.fixture';

describe('EnvModule', () => {
  const savedEnv = { ...process.env };
  afterEach(() => {
    for (const name of Object.keys(process.env))
      if (!(name in savedEnv)) delete process.env[name];
    Object.assign(process.env, savedEnv);
    jest.restoreAllMocks();
  });

  it('warns once by name when a moved variable is still set, never its value', async () => {
    Object.assign(process.env, validEnv, {
      SMTP_URL: 'smtp://user:hunter2@mail.test:587',
    });
    const warn = jest.spyOn(Logger.prototype, 'warn');

    const moduleRef = await Test.createTestingModule({
      imports: [EnvModule],
    }).compile();

    try {
      expect(moduleRef.get<Env>(ENV).mongoUrl).toBe(validEnv.MONGO_URL);
      const messages = warn.mock.calls.map(([message]) => String(message));
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain('SMTP_URL');
      expect(messages[0]).not.toContain('hunter2');
    } finally {
      await moduleRef.close();
    }
  });
});
