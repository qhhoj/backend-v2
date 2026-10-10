import { tmpdir } from 'node:os';
import { getQueueToken } from '@nestjs/bullmq';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import Redis from 'ioredis';
import type { Connection, Model } from 'mongoose';
import { TEST_ENV, TEST_REDIS_URL } from '@libs/common/testing';
import {
  Contest,
  ContestParticipation,
  ContestSubmission,
  Judge,
  Language,
  Problem,
  Submission,
  SubmissionSource,
  User,
} from '@libs/database';
import { startMongo } from '@libs/database/testing';
import { SUBMISSION_GRADED_QUEUE } from '@libs/judging';
import type { SubmissionGradedJob } from '@libs/judging';
import { BridgeModule } from '../src/bridge.module';
import { BRIDGE_TIMINGS } from '../src/bridge-timings';
import type { BridgeTimings } from '../src/bridge-timings';
import { JudgeLinkServer } from '../src/link/judge-link.server';

/** Milliseconds instead of seconds; `resyncMs` stays long so a test sees only the dispatches it caused (restart tests shorten it). No test waits for the idle or accept clock to expire, so both are long enough that a loaded host (event-loop stalls of seconds) never drops a judge or releases a slow Accepted mid-test. */
export const FAST_TIMINGS: BridgeTimings = {
  handshakeMs: 500,
  idleMs: 5000,
  pingIntervalMs: 200,
  resyncMs: 60_000,
  acceptMs: 5000,
  resumeGraceMs: 300,
  runMarginMs: 600_000,
  runCaseBudget: 100,
  pinFallbackMs: 600_000,
};

export async function setupBridgeTest({
  timings = {},
  env = {},
}: {
  timings?: Partial<BridgeTimings>;
  /** Extra environment, e.g. the judge port's TLS pair. */
  env?: Record<string, string>;
} = {}) {
  const replSet = await startMongo();
  Object.assign(process.env, TEST_ENV, {
    MONGO_URL: replSet.getUri('qhhoj'),
    MEDIA_ROOT: tmpdir(),
    PROBLEM_DATA_ROOT: tmpdir(),
    PDF_CACHE_ROOT: tmpdir(),
    JUDGE_BRIDGE_HOST: '127.0.0.1',
    JUDGE_BRIDGE_PORT: '0',
    JUDGE_BRIDGE_TLS_CERT: '',
    JUDGE_BRIDGE_TLS_KEY: '',
    ...env,
  });
  const compile = async (): Promise<TestingModule> => {
    const compiled = await Test.createTestingModule({ imports: [BridgeModule] })
      .overrideProvider(BRIDGE_TIMINGS)
      .useValue({ ...FAST_TIMINGS, ...timings })
      .compile();
    try {
      await compiled.init();
    } catch (error) {
      await compiled.close();
      throw error;
    }
    return compiled;
  };
  let current: TestingModule;
  /** Set while `current` is closed (a failed restart), so `teardown` does not close it twice. */
  let currentClosed = false;
  try {
    const redis = new Redis(TEST_REDIS_URL);
    await redis.flushdb();
    await redis.quit();
    current = await compile();
  } catch (error) {
    await replSet.stop();
    throw error;
  }
  const model = <Entity>(name: string) =>
    current.get<Model<Entity>>(getModelToken(name));
  const graded = () =>
    current.get<Queue<SubmissionGradedJob>>(
      getQueueToken(SUBMISSION_GRADED_QUEUE),
    );
  return {
    get module() {
      return current;
    },
    get submissions() {
      return model<Submission>(Submission.name);
    },
    get sources() {
      return model<SubmissionSource>(SubmissionSource.name);
    },
    get judges() {
      return model<Judge>(Judge.name);
    },
    get problems() {
      return model<Problem>(Problem.name);
    },
    get languages() {
      return model<Language>(Language.name);
    },
    get users() {
      return model<User>(User.name);
    },
    get contests() {
      return model<Contest>(Contest.name);
    },
    get participations() {
      return model<ContestParticipation>(ContestParticipation.name);
    },
    get contestSubmissions() {
      return model<ContestSubmission>(ContestSubmission.name);
    },
    get graded() {
      return graded();
    },
    /** The port the current module's judge server listens on (`JUDGE_BRIDGE_PORT=0`). */
    judgePort: () => current.get(JudgeLinkServer).port(),
    /** Nothing consumes the queue in 2a, so every job waits. */
    gradedJobs: async (): Promise<SubmissionGradedJob[]> =>
      (await graded().getJobs(['waiting'])).map((job) => job.data),
    /** Empties every collection and the graded queue (between conformance scenarios). */
    reset: async () => {
      const connection = current.get<Connection>(getConnectionToken());
      for (const collection of await connection.db!.collections())
        await collection.deleteMany({});
      await graded().obliterate({ force: true });
    },
    /** A bridge process restart: same Mongo and Redis, fresh in-memory state; `timings` replaces the overrides from here on. */
    restart: async (nextTimings?: Partial<BridgeTimings>) => {
      if (nextTimings) timings = nextTimings;
      await current.close();
      currentClosed = true;
      current = await compile();
      currentClosed = false;
    },
    teardown: async () => {
      if (!currentClosed) await current.close();
      await replSet.stop();
    },
  };
}

export type BridgeTest = Awaited<ReturnType<typeof setupBridgeTest>>;
