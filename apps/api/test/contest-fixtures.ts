import type Redis from 'ioredis';
import { REDIS } from '@libs/common';
import type {
  Contest,
  ContestParticipation,
  ContestProblem,
} from '@libs/database';
import type { ApiTest } from './setup';

export const hoursFromNow = (hours: number): Date =>
  new Date(Date.now() + hours * 3_600_000);

let contests = 0;
/** A visible public contest running from an hour ago for three hours, unless overridden. */
export const createContest = (api: ApiTest, overrides: Partial<Contest> = {}) =>
  api.contests.create({
    key: `contest_${(contests += 1)}`,
    name: 'Contest',
    startTime: hoursFromNow(-1),
    endTime: hoursFromNow(2),
    isVisible: true,
    ...overrides,
  });

export const contestProblem = (
  problemId: string,
  order: number,
  extra: Partial<ContestProblem> = {},
): ContestProblem => ({
  problem: problemId,
  points: 100,
  partial: true,
  isPretested: false,
  order,
  outputPrefixOverride: null,
  maxSubmissions: null,
  ...extra,
});

export const joinParticipation = (
  api: ApiTest,
  contestId: string,
  userId: string,
  extra: Partial<ContestParticipation> = {},
) =>
  api.participations.create({
    contest: contestId,
    user: userId,
    realStart: new Date(),
    virtual: 0,
    ...extra,
  });

export const makeCurrent = (
  api: ApiTest,
  userId: string,
  participationId: string | null,
) =>
  api.users.updateOne(
    { _id: userId },
    { currentParticipation: participationId },
  );

export const contestUrl = (key: string, suffix = '') =>
  `/api/internal/contests/${key}${suffix}`;

/** Rate-limit counters are global per Redis db: a test that counts attempts starts from zero. */
export const clearRateLimits = async (api: ApiTest): Promise<void> => {
  const redis = api.app.get<Redis>(REDIS);
  const keys = await redis.keys('rate:*');
  if (keys.length) await redis.del(...keys);
};
