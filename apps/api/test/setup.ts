import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Type } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { hashPassword, SessionService } from '@libs/auth';
import { BaseCatalogQuerier, MAILER, REDIS, TUNING } from '@libs/common';
import {
  createTestApp,
  InMemoryMailer,
  TEST_ENV,
  TEST_TUNING,
} from '@libs/common/testing';
import type { User } from '@libs/database';
import { modelsOf, startMongo } from '@libs/database/testing';
import { SettingsQuerier, SettingsService } from '@libs/settings';
import type { SettingKey } from '@libs/settings';
import Redis from 'ioredis';
import type { Connection, Model } from 'mongoose';
import request from 'supertest';
import { apiTuning } from '../src/api-tuning';
import type { ApiTuning } from '../src/api-tuning';
import { AppModule } from '../src/app.module';
import { setupApiDocs } from '../src/api-docs';
import { setupOpenApi } from '../src/openapi';

export { TEST_ENV };

/** The settings every spec starts from: no breach lookups over the network. */
const applyTestSettings = (app: NestFastifyApplication) =>
  app.get(SettingsService).set('auth.pwnedApiUrl', '', null);

export async function setupApiTest({
  controllers = [],
  overrides = [],
  env = {},
  tuning: replaced = {},
}: {
  controllers?: Type[];
  overrides?: Array<{ provide: unknown; useValue: unknown }>;
  /** Extra environment variables, applied after the defaults. */
  env?: Record<string, string>;
  /** Parts of the api tuning to replace; the whole object is `tuning` on the result, which a spec may change mid-run. */
  tuning?: Partial<ApiTuning>;
} = {}) {
  const mailer = new InMemoryMailer();
  const tuning: ApiTuning = { ...apiTuning, ...TEST_TUNING, ...replaced };
  const replSet = await startMongo();
  const mediaRoot = mkdtempSync(join(tmpdir(), 'qhhoj-media-'));
  const problemDataRoot = mkdtempSync(join(tmpdir(), 'qhhoj-problem-data-'));
  const pdfCacheRoot = mkdtempSync(join(tmpdir(), 'qhhoj-pdf-cache-'));
  const contestDataRoot = mkdtempSync(join(tmpdir(), 'qhhoj-contest-data-'));
  const userDataRoot = mkdtempSync(join(tmpdir(), 'qhhoj-user-data-'));
  const removeRoots = () =>
    [
      mediaRoot,
      problemDataRoot,
      pdfCacheRoot,
      contestDataRoot,
      userDataRoot,
    ].forEach((root) => rmSync(root, { recursive: true, force: true }));
  Object.assign(process.env, TEST_ENV, {
    MONGO_URL: replSet.getUri('qhhoj'),
    MEDIA_ROOT: mediaRoot,
    PROBLEM_DATA_ROOT: problemDataRoot,
    PDF_CACHE_ROOT: pdfCacheRoot,
    CONTEST_DATA_ROOT: contestDataRoot,
    USER_DATA_ROOT: userDataRoot,
    ...env,
  });
  let app: NestFastifyApplication | undefined;
  try {
    app = await createTestApp(
      { imports: [AppModule], controllers },
      {
        beforeInit: (app) => {
          setupOpenApi(app);
          setupApiDocs(app);
        },
        overrides: [
          { provide: MAILER, useValue: mailer },
          { provide: TUNING, useValue: tuning },
          ...overrides,
        ],
      },
    );
    await app.listen(0, '127.0.0.1');
    await app.get<Redis>(REDIS).flushdb();
    await applyTestSettings(app);
    // Queries that `.hint()` an index fail until its build finishes.
    const connection = app.get<Connection>(getConnectionToken());
    await Promise.all(
      Object.values(connection.models).map((model) => model.init()),
    );
  } catch (error) {
    try {
      await app?.close();
    } finally {
      await replSet.stop();
      removeRoots();
    }
    throw error;
  }
  const readyApp = app;
  return {
    app: readyApp,
    http: () => request(readyApp.getHttpServer()),
    ...modelsOf(readyApp),
    db: readyApp.get<Connection>(getConnectionToken()).db!,
    /** Streams are off in specs: call after inserting catalog rows. Resyncs every catalog querier the app registers. */
    resyncCatalog: async () => {
      const queriers = [...readyApp.get(ModulesContainer).values()].flatMap(
        ({ providers }) =>
          [...providers.values()]
            .map(({ instance }) => instance)
            .filter((instance) => instance instanceof BaseCatalogQuerier),
      );
      await Promise.all(queriers.map((querier) => querier.resync()));
    },
    tuning,
    mediaRoot,
    problemDataRoot,
    pdfCacheRoot,
    contestDataRoot,
    userDataRoot,
    sessions: readyApp.get(SessionService),
    mailer,
    /** Writes through the real service, so readers see it at once. */
    setSetting: (key: SettingKey, value: unknown) =>
      readyApp.get(SettingsService).set(key, value, null),
    /** Empties every model, Redis, the mailer and the data roots and restores the test settings, so specs merged into one app start clean. */
    reset: async () => {
      mailer.sent.length = 0;
      await readyApp.get<Redis>(REDIS).flushdb();
      const { models } = readyApp.get<Connection>(getConnectionToken());
      await Promise.all(
        Object.values(models).map((model) => model.deleteMany({})),
      );
      // the emptied settings collection reaches the snapshot now, not at its next one-minute resync mid-spec
      await readyApp.get(SettingsQuerier).resync();
      await applyTestSettings(readyApp);
      for (const root of [
        mediaRoot,
        problemDataRoot,
        pdfCacheRoot,
        contestDataRoot,
        userDataRoot,
      ]) {
        rmSync(root, { recursive: true, force: true });
        mkdirSync(root, { recursive: true });
      }
    },
    teardown: async () => {
      await readyApp.close();
      await replSet.stop();
      removeRoots();
    },
  };
}

export type ApiTest = Awaited<ReturnType<typeof setupApiTest>>;

/** Hashed at the e2e cost (`TEST_TUNING`): a login verifies it fast and does not rehash it. */
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
    password: await hashPassword(password, {
      iterations: TEST_TUNING.passwordIterations,
    }),
  });

export const sessionCookie = (id: string) => `qhhoj_session=${id}`;

/** Asserts the codes of the response's top-level `error.issues[]`, in order. */
export const issueCodes =
  (codes: string[]) =>
  ({ body }: { body: { error: { issues?: { code: string }[] } } }) =>
    expect((body.error.issues ?? []).map((issue) => issue.code)).toEqual(codes);

export const errorCode =
  (code: string) =>
  ({ body }: { body: { error: { code: string } } }) =>
    expect(body.error.code).toBe(code);
