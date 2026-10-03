import { Type } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { hashPassword, SessionService } from '@libs/auth';
import { MAILER, REDIS } from '@libs/common';
import {
  createTestApp,
  InMemoryMailer,
  TEST_REDIS_URL,
} from '@libs/common/testing';
import {
  Group,
  Language,
  License,
  Problem,
  ProblemGroup,
  ProblemType,
  Revision,
  User,
} from '@libs/database';
import { startMongo } from '@libs/database/testing';
import Redis from 'ioredis';
import { Model } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { LanguagesQuerier } from '../src/modules/problems/languages.querier';
import { LicensesQuerier } from '../src/modules/problems/licenses.querier';
import { ProblemGroupsQuerier } from '../src/modules/problems/problem-groups.querier';
import { ProblemTypesQuerier } from '../src/modules/problems/problem-types.querier';
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
  SMTP_URL: 'smtp://127.0.0.1:2525',
};

export async function setupApiTest({
  controllers = [],
  overrides = [],
}: {
  controllers?: Type[];
  overrides?: Array<{ provide: unknown; useValue: unknown }>;
} = {}) {
  const mailer = new InMemoryMailer();
  const replSet = await startMongo();
  Object.assign(process.env, TEST_ENV, { MONGO_URL: replSet.getUri('qhhoj') });
  let app: NestFastifyApplication | undefined;
  try {
    app = await createTestApp(
      { imports: [AppModule], controllers },
      {
        beforeInit: setupOpenApi,
        overrides: [{ provide: MAILER, useValue: mailer }, ...overrides],
      },
    );
    await app.listen(0, '127.0.0.1');
    await app.get<Redis>(REDIS).flushdb();
  } catch (error) {
    try {
      await app?.close();
    } finally {
      await replSet.stop();
    }
    throw error;
  }
  const readyApp = app;
  return {
    app: readyApp,
    http: () => request(readyApp.getHttpServer()),
    users: readyApp.get<Model<User>>(getModelToken(User.name)),
    groups: readyApp.get<Model<Group>>(getModelToken(Group.name)),
    problemTypes: readyApp.get<Model<ProblemType>>(
      getModelToken(ProblemType.name),
    ),
    problemGroups: readyApp.get<Model<ProblemGroup>>(
      getModelToken(ProblemGroup.name),
    ),
    problems: readyApp.get<Model<Problem>>(getModelToken(Problem.name)),
    revisions: readyApp.get<Model<Revision>>(getModelToken(Revision.name)),
    licenses: readyApp.get<Model<License>>(getModelToken(License.name)),
    languages: readyApp.get<Model<Language>>(getModelToken(Language.name)),
    /** Streams are disabled in tests; call after inserting catalog rows. */
    resyncCatalog: async () => {
      await Promise.all(
        [
          ProblemTypesQuerier,
          ProblemGroupsQuerier,
          LicensesQuerier,
          LanguagesQuerier,
        ].map((querier) => readyApp.get(querier).resync()),
      );
    },
    sessions: readyApp.get(SessionService),
    mailer,
    teardown: async () => {
      await readyApp.close();
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
