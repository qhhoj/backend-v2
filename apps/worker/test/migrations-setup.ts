import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { REDIS } from '@libs/common';
import { TEST_ENV } from '@libs/common/testing';
import { startMongo } from '@libs/database/testing';
import type Redis from 'ioredis';
import type { Model } from 'mongoose';
import { MigrationsModule } from '../src/migrations/migrations.module';

/** The module `worker migrate` boots, on a database, a Redis db and data roots of its own; `override` replaces a provider. */
export async function setupMigrationsTest(override?: {
  provide: unknown;
  useValue: unknown;
}) {
  const mongo = await startMongo();
  const roots = {
    mediaRoot: mkdtempSync(join(tmpdir(), 'qhhoj-media-')),
    problemDataRoot: mkdtempSync(join(tmpdir(), 'qhhoj-problem-data-')),
    pdfCacheRoot: mkdtempSync(join(tmpdir(), 'qhhoj-pdf-cache-')),
  };
  Object.assign(process.env, TEST_ENV, {
    MONGO_URL: mongo.getUri('qhhoj'),
    MEDIA_ROOT: roots.mediaRoot,
    PROBLEM_DATA_ROOT: roots.problemDataRoot,
    PDF_CACHE_ROOT: roots.pdfCacheRoot,
  });
  const builder = Test.createTestingModule({ imports: [MigrationsModule] });
  if (override)
    builder.overrideProvider(override.provide).useValue(override.useValue);
  const module: TestingModule = await builder.compile();
  await module.init();
  const redis = module.get<Redis>(REDIS);
  await redis.flushdb();
  return {
    module,
    redis,
    ...roots,
    model: <T>(name: string) => module.get<Model<T>>(getModelToken(name)),
    teardown: async () => {
      await module.close();
      await mongo.stop();
      for (const root of Object.values(roots))
        rmSync(root, { recursive: true, force: true });
    },
  };
}

export type MigrationsTest = Awaited<ReturnType<typeof setupMigrationsTest>>;
