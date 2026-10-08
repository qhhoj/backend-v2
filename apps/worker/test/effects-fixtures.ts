import type { UUID } from 'mongodb';
import { newId, toUuid, uuidStr } from '@libs/database';
import type {
  Contest,
  ContestParticipation,
  Organization,
  Problem,
  Submission,
  User,
} from '@libs/database';
import type { WorkerTest } from './setup';

let users = 0;
let problems = 0;

export const seedUser = (worker: WorkerTest, extra: Partial<User> = {}) => {
  users += 1;
  return worker.users.create({
    username: `effects_user${users}`,
    password: '!',
    isActive: true,
    ...extra,
  });
};

export const problemFields = (extra: Partial<Problem> = {}) => {
  problems += 1;
  return {
    code: `effects${problems}`,
    name: `Effects ${problems}`,
    timeLimit: 1,
    memoryLimit: 262144,
    points: 1000,
    partial: true,
    isPublic: true,
    typeIds: [newId()],
    groupId: newId(),
    ...extra,
  };
};

export const seedProblem = (worker: WorkerTest, extra: Partial<Problem> = {}) =>
  worker.problems.create(problemFields(extra));

/** A graded (D) submission, AC with full marks unless `fields` say otherwise. */
export const seedGraded = (
  worker: WorkerTest,
  user: string,
  problem: string,
  fields: Partial<Submission> = {},
) =>
  worker.submissions.create({
    user,
    problem,
    language: newId(),
    status: 'D',
    result: 'AC',
    points: 1000,
    casePoints: 1,
    caseTotal: 1,
    judgedDate: new Date(),
    ...fields,
  });

export interface GradedRow {
  user: string;
  problem: string;
  result: 'AC' | 'WA';
  points: number;
  casePoints: number;
  caseTotal: number;
  /** `date` and `judgedDate`; now when omitted. */
  at?: Date;
}

/** Scale fixtures through the driver, 10000 rows per insert; every field the effects read is given (no Mongoose defaults). */
export async function insertGradedRows(
  worker: WorkerTest,
  count: number,
  rowAt: (index: number) => GradedRow,
): Promise<void> {
  const batch = 10_000;
  for (let start = 0; start < count; start += batch)
    await worker.db
      .collection<{ _id: UUID }>(worker.submissions.collection.name)
      .insertMany(
        Array.from(
          { length: Math.min(batch, count - start) },
          (_unused, offset) => {
            const row = rowAt(start + offset);
            return {
              _id: toUuid(newId()),
              user: toUuid(row.user),
              problem: toUuid(row.problem),
              language: toUuid(newId()),
              status: 'D',
              result: row.result,
              points: row.points,
              casePoints: row.casePoints,
              caseTotal: row.caseTotal,
              date: row.at ?? new Date(),
              judgedDate: row.at ?? new Date(),
              priority: 1,
              rejudgedDate: null,
            };
          },
        ),
      );
}

let organizationCount = 0;
export const seedOrganization = (
  worker: WorkerTest,
  extra: Partial<Organization> = {},
) => {
  organizationCount += 1;
  return worker.organizations.create({
    name: `Effects ${organizationCount}`,
    slug: `effects${organizationCount}`,
    shortName: `effects${organizationCount}`,
    ...extra,
  });
};

let contestCount = 0;
/** A default-format contest running from an hour ago for three hours. */
export const seedContest = (worker: WorkerTest, extra: Partial<Contest> = {}) =>
  worker.contests.create({
    key: `effects_contest_${(contestCount += 1)}`,
    name: 'Effects contest',
    startTime: new Date(Date.now() - 3_600_000),
    endTime: new Date(Date.now() + 7_200_000),
    ...extra,
  });

export const seedParticipation = (
  worker: WorkerTest,
  contestId: string,
  userId: string,
  extra: Partial<ContestParticipation> = {},
) =>
  worker.participations.create({
    contest: contestId,
    user: userId,
    realStart: new Date(Date.now() - 3_600_000),
    ...extra,
  });

/** A graded contest submission: the submission (AC full marks unless `fields` say otherwise) and its contest row. */
export async function seedContestSubmission(
  worker: WorkerTest,
  participation: { _id: string; contest: string; user: string },
  problemId: string,
  {
    fields = {},
    points = 0,
  }: { fields?: Partial<Submission>; points?: number } = {},
) {
  const submission = await seedGraded(
    worker,
    uuidStr(participation.user),
    problemId,
    { contest: uuidStr(participation.contest), ...fields },
  );
  await worker.contestSubmissions.create({
    _id: submission._id,
    participation: participation._id,
    contest: participation.contest,
    problem: problemId,
    points,
  });
  return submission;
}
