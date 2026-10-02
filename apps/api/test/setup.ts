import { Type } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { hashPassword, SessionService } from '@libs/auth';
import { REDIS } from '@libs/common';
import { createTestApp, TEST_REDIS_URL } from '@libs/common/testing';
import { Group, User } from '@libs/database';
import { startMongo } from '@libs/database/testing';
import Redis from 'ioredis';
import { Model } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { setupOpenApi } from '../src/openapi';

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
};

export async function setupApiTest({
  controllers = [],
}: { controllers?: Type[] } = {}) {
  const replSet = await startMongo();
  Object.assign(process.env, TEST_ENV, { MONGO_URL: replSet.getUri('qhhoj') });
  let app: NestFastifyApplication;
  try {
    app = await createTestApp(
      { imports: [AppModule], controllers },
      setupOpenApi,
    );
    await app.listen(0, '127.0.0.1');
    await app.get<Redis>(REDIS).flushdb();
  } catch (error) {
    await replSet.stop();
    throw error;
  }
  return {
    app,
    http: () => request(app.getHttpServer()),
    users: app.get<Model<User>>(getModelToken(User.name)),
    groups: app.get<Model<Group>>(getModelToken(Group.name)),
    sessions: app.get(SessionService),
    teardown: async () => {
      await app.close();
      await replSet.stop();
    },
  };
}

export type ApiTest = Awaited<ReturnType<typeof setupApiTest>>;

/** Fast hash (1000 iterations) unless a test needs real cost; `needsRehash` will upgrade it on login. */
export const createUser = async (
  users: Model<User>,
  {
    password = 'correct horse battery',
    ...fields
  }: Partial<User> & { password?: string },
) =>
  users.create({
    username: 'alice',
    email: 'alice@example.com',
    isActive: true,
    ...fields,
    password: await hashPassword(password, 1000),
  });

export const sessionCookie = (id: string) => `qhhoj_session=${id}`;

export const errorCode =
  (code: string) =>
  ({ body }: { body: { error: { code: string } } }) =>
    expect(body.error.code).toBe(code);
