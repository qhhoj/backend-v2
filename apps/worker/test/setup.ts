import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { TEST_ENV, TEST_REDIS_URL, waitUntil } from '@libs/common/testing';
import { CONTEST_FINAL_JUDGE_QUEUE } from '@libs/contests';
import { EFFECTS_SWEEP_QUEUE } from '@libs/judging';
import {
  Contest,
  ContestParticipation,
  ContestSubmission,
  Language,
  Problem,
  ProblemGroup,
  ProblemType,
  Submission,
  User,
} from '@libs/database';
import { startMongo } from '@libs/database/testing';
import Redis from 'ioredis';
import type { Queue } from 'bullmq';
import type { Connection, Model } from 'mongoose';
import { WorkerModule } from '../src/worker.module';

const temporaryDirectory = (prefix: string) =>
  mkdtempSync(join(tmpdir(), prefix));

export async function setupWorkerTest({
  overrides = [],
  env = {},
  seedBeforeBoot,
}: {
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
  const flushRedis = async () => {
    const redis = new Redis(TEST_REDIS_URL);
    await redis.flushdb();
    await redis.quit();
  };
  const builder = Test.createTestingModule({ imports: [WorkerModule] });
  for (const { provide, useValue } of overrides)
    builder.overrideProvider(provide).useValue(useValue);
  let testingModule: TestingModule | undefined;
  try {
    await flushRedis();
    await seedBeforeBoot?.(replSet.getUri('qhhoj'));
    testingModule = await builder.compile();
    await testingModule.init();
    if (!seedBeforeBoot) {
      // Boot-time sweeps must finish before the flush, or they fail on their vanished jobs and race the tests.
      const sweepQueues = [EFFECTS_SWEEP_QUEUE, CONTEST_FINAL_JUDGE_QUEUE].map(
        (name) => testingModule!.get<Queue>(getQueueToken(name)),
      );
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
    problems: ready.get<Model<Problem>>(getModelToken(Problem.name)),
    languages: ready.get<Model<Language>>(getModelToken(Language.name)),
    users: ready.get<Model<User>>(getModelToken(User.name)),
    problemTypes: ready.get<Model<ProblemType>>(
      getModelToken(ProblemType.name),
    ),
    problemGroups: ready.get<Model<ProblemGroup>>(
      getModelToken(ProblemGroup.name),
    ),
    submissions: ready.get<Model<Submission>>(getModelToken(Submission.name)),
    contests: ready.get<Model<Contest>>(getModelToken(Contest.name)),
    participations: ready.get<Model<ContestParticipation>>(
      getModelToken(ContestParticipation.name),
    ),
    contestSubmissions: ready.get<Model<ContestSubmission>>(
      getModelToken(ContestSubmission.name),
    ),
    db: ready.get<Connection>(getConnectionToken()).db!,
    ...roots,
    teardown: async () => {
      await ready.close();
      await cleanup();
    },
  };
}

export type WorkerTest = Awaited<ReturnType<typeof setupWorkerTest>>;
