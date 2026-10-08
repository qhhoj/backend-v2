import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { TEST_ENV, TEST_REDIS_URL, waitUntil } from '@libs/common/testing';
import { USER_DATA_QUEUE } from '@libs/community';
import { CONTEST_FINAL_JUDGE_QUEUE } from '@libs/contests';
import { EFFECTS_SWEEP_QUEUE } from '@libs/judging';
import {
  Contest,
  SimilarityPair,
  SimilarityRun,
  ContestParticipation,
  ContestSubmission,
  Language,
  BlogPost,
  Comment,
  Organization,
  Problem,
  ProblemGroup,
  ProblemType,
  Rating,
  Submission,
  TagProblem,
  SubmissionSource,
  Ticket,
  User,
} from '@libs/database';
import { startMongo } from '@libs/database/testing';
import { SettingsService } from '@libs/settings';
import type { SettingKey } from '@libs/settings';
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
  const builder = Test.createTestingModule({ imports: [WorkerModule] });
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
        EFFECTS_SWEEP_QUEUE,
        CONTEST_FINAL_JUDGE_QUEUE,
        USER_DATA_QUEUE,
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
    submissionSources: ready.get<Model<SubmissionSource>>(
      getModelToken(SubmissionSource.name),
    ),
    contests: ready.get<Model<Contest>>(getModelToken(Contest.name)),
    participations: ready.get<Model<ContestParticipation>>(
      getModelToken(ContestParticipation.name),
    ),
    contestSubmissions: ready.get<Model<ContestSubmission>>(
      getModelToken(ContestSubmission.name),
    ),
    ratings: ready.get<Model<Rating>>(getModelToken(Rating.name)),
    similarityRuns: ready.get<Model<SimilarityRun>>(
      getModelToken(SimilarityRun.name),
    ),
    similarityPairs: ready.get<Model<SimilarityPair>>(
      getModelToken(SimilarityPair.name),
    ),
    organizations: ready.get<Model<Organization>>(
      getModelToken(Organization.name),
    ),
    blogPosts: ready.get<Model<BlogPost>>(getModelToken(BlogPost.name)),
    comments: ready.get<Model<Comment>>(getModelToken(Comment.name)),
    tickets: ready.get<Model<Ticket>>(getModelToken(Ticket.name)),
    tagProblems: ready.get<Model<TagProblem>>(getModelToken(TagProblem.name)),
    db: ready.get<Connection>(getConnectionToken()).db!,
    ...roots,
    /** Writes through the real service, so readers see it at once. */
    setSetting: (key: SettingKey, value: unknown) =>
      ready.get(SettingsService).set(key, value, null),
    teardown: async () => {
      await ready.close();
      await cleanup();
    },
  };
}

export type WorkerTest = Awaited<ReturnType<typeof setupWorkerTest>>;
