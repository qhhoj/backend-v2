import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { TEST_ENV, TEST_REDIS_URL } from '@libs/common/testing';
import {
  Language,
  Problem,
  ProblemGroup,
  ProblemType,
  User,
} from '@libs/database';
import { startMongo } from '@libs/database/testing';
import Redis from 'ioredis';
import type { Model } from 'mongoose';
import { WorkerModule } from '../src/worker.module';

const temporaryDirectory = (prefix: string) =>
  mkdtempSync(join(tmpdir(), prefix));

export async function setupWorkerTest({
  overrides = [],
  env = {},
}: {
  /** Extra environment variables (e.g. render limits), applied before the module compiles. */
  env?: Record<string, string>;
  overrides?: Array<{ provide: unknown; useValue: unknown }>;
} = {}) {
  const replSet = await startMongo();
  const roots = {
    mediaRoot: temporaryDirectory('qhhoj-media-'),
    problemDataRoot: temporaryDirectory('qhhoj-problem-data-'),
    pdfCacheRoot: temporaryDirectory('qhhoj-pdf-cache-'),
  };
  Object.assign(process.env, TEST_ENV, {
    MONGO_URL: replSet.getUri('qhhoj'),
    MEDIA_ROOT: roots.mediaRoot,
    PROBLEM_DATA_ROOT: roots.problemDataRoot,
    PDF_CACHE_ROOT: roots.pdfCacheRoot,
    ...env,
  });
  const cleanup = async () => {
    await replSet.stop();
    for (const root of Object.values(roots))
      rmSync(root, { recursive: true, force: true });
  };
  const builder = Test.createTestingModule({ imports: [WorkerModule] });
  for (const { provide, useValue } of overrides)
    builder.overrideProvider(provide).useValue(useValue);
  let testingModule: TestingModule | undefined;
  try {
    testingModule = await builder.compile();
    await testingModule.init();
    const redis = new Redis(TEST_REDIS_URL);
    await redis.flushdb();
    await redis.quit();
  } catch (error) {
    await testingModule?.close();
    await cleanup();
    throw error;
  }
  const ready = testingModule;
  return {
    module: ready,
    problems: ready.get<Model<Problem>>(getModelToken(Problem.name)),
    languages: ready.get<Model<Language>>(getModelToken(Language.name)),
    users: ready.get<Model<User>>(getModelToken(User.name)),
    problemTypes: ready.get<Model<ProblemType>>(
      getModelToken(ProblemType.name),
    ),
    problemGroups: ready.get<Model<ProblemGroup>>(
      getModelToken(ProblemGroup.name),
    ),
    ...roots,
    teardown: async () => {
      await ready.close();
      await cleanup();
    },
  };
}

export type WorkerTest = Awaited<ReturnType<typeof setupWorkerTest>>;
