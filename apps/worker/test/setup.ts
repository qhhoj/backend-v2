import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { TUNING } from '@libs/common';
import {
  TEST_ENV,
  TEST_REDIS_URL,
  TEST_TUNING,
  waitUntil,
} from '@libs/common/testing';
import { communityJobs } from '@libs/community';
import { contestJobs } from '@libs/contests';
import { judgingJobs } from '@libs/judging';
import { modelsOf, startMongo } from '@libs/database/testing';
import { SettingsService } from '@libs/settings';
import type { SettingKey } from '@libs/settings';
import Redis from 'ioredis';
import type { Queue } from 'bullmq';
import type { Connection } from 'mongoose';
import { WorkerModule } from '../src/worker.module';
import { workerTuning } from '../src/worker-tuning';
import type { WorkerTuning } from '../src/worker-tuning';

const temporaryDirectory = (prefix: string) =>
  mkdtempSync(join(tmpdir(), prefix));

export async function setupWorkerTest({
  overrides = [],
  env = {},
  tuning: replaced = {},
  seedBeforeBoot,
}: {
  /** Parts of the worker tuning to replace; the whole object is `tuning` on the result, which a spec may change mid-run. */
  tuning?: Partial<WorkerTuning>;
  /** Runs against the empty database and Redis before the module boots (no indexes yet, a queued job already waiting); Redis is then not flushed after boot. */
  seedBeforeBoot?: (mongoUri: string) => Promise<void>;
  /** Extra environment variables (e.g. render limits), applied before the module compiles. */
  env?: Record<string, string>;
  overrides?: Array<{ provide: unknown; useValue: unknown }>;
} = {}) {
  const replSet = await startMongo();
  const roots = {
    mediaRoot: temporaryDirectory('qhhoj-media-'),
    problemDataRoot: temporaryDirectory('qhhoj-problem-data-'),
    pdfCacheRoot: temporaryDirectory('qhhoj-pdf-cache-'),
    contestDataRoot: temporaryDirectory('qhhoj-contest-data-'),
    userDataRoot: temporaryDirectory('qhhoj-user-data-'),
  };
  Object.assign(process.env, TEST_ENV, {
    MONGO_URL: replSet.getUri('qhhoj'),
    MEDIA_ROOT: roots.mediaRoot,
    PROBLEM_DATA_ROOT: roots.problemDataRoot,
    PDF_CACHE_ROOT: roots.pdfCacheRoot,
    CONTEST_DATA_ROOT: roots.contestDataRoot,
    USER_DATA_ROOT: roots.userDataRoot,
    ...env,
  });
  const cleanup = async () => {
    await replSet.stop();
    for (const root of Object.values(roots))
      rmSync(root, { recursive: true, force: true });
  };
  const flushRedis = async () => {
    const redis = new Redis(TEST_REDIS_URL);
    await redis.flushdb();
    await redis.quit();
  };
  const tuning: WorkerTuning = { ...workerTuning, ...TEST_TUNING, ...replaced };
  const builder = Test.createTestingModule({ imports: [WorkerModule] })
    .overrideProvider(TUNING)
    .useValue(tuning);
  for (const { provide, useValue } of overrides)
    builder.overrideProvider(provide).useValue(useValue);
  let testingModule: TestingModule | undefined;
  try {
    await flushRedis();
    await seedBeforeBoot?.(replSet.getUri('qhhoj'));
    testingModule = await builder.compile();
    await testingModule.init();
    // Queries that `.hint()` an index fail until its build finishes.
    const connection = testingModule.get<Connection>(getConnectionToken());
    await Promise.all(
      Object.values(connection.models).map((model) => model.init()),
    );
    if (!seedBeforeBoot) {
      // Boot-time sweeps must finish before the flush, or they fail on their vanished jobs and race the tests.
      const sweepQueues = [
        judgingJobs.effectsSweep.queue,
        contestJobs.finalJudge.queue,
        contestJobs.publish.queue,
        communityJobs.userData.queue,
        contestJobs.export.queue,
      ].map((name) => testingModule!.get<Queue>(getQueueToken(name)));
      await waitUntil(async () => {
        for (const queue of sweepQueues) {
          const { active, waiting } = await queue.getJobCounts(
            'active',
            'waiting',
          );
          if (active + waiting) return false;
        }
        return true;
      });
      await flushRedis();
    }
  } catch (error) {
    await testingModule?.close();
    await cleanup();
    throw error;
  }
  const ready = testingModule;
  return {
    module: ready,
    tuning,
    ...modelsOf(ready),
    db: ready.get<Connection>(getConnectionToken()).db!,
    ...roots,
    /** Writes through the real service, so readers see it at once. */
    setSetting: (key: SettingKey, value: unknown) =>
      ready.get(SettingsService).set(key, value, null),
    /** Empties every model, Redis and the data roots, so specs merged into one app start clean. */
    reset: async () => {
      await flushRedis();
      const { models } = ready.get<Connection>(getConnectionToken());
      await Promise.all(
        Object.values(models).map((model) => model.deleteMany({})),
      );
      for (const root of Object.values(roots)) {
        rmSync(root, { recursive: true, force: true });
        mkdirSync(root, { recursive: true });
      }
    },
    teardown: async () => {
      await ready.close();
      await cleanup();
    },
  };
}

export type WorkerTest = Awaited<ReturnType<typeof setupWorkerTest>>;
