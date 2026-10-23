import type { UUID } from 'mongodb';
import mongoose from 'mongoose';
import {
  newId,
  OrganizationJudgingChargeSchema,
  ProblemSchema,
  SubmissionSchema,
  toUuid,
  uuidStr,
} from '@libs/database';
import type { SubmissionCase } from '@libs/database';
import { startMongo } from '@libs/database/testing';
import type { TestMongo } from '@libs/database/testing';
import { EXTERNAL_JUDGE_NAME } from '@libs/judging';
import type { SettingsService } from '@libs/settings';
import { JudgingCharges } from './judging-charges.service';

const TIME_ZONE = 'Asia/Ho_Chi_Minh';
const OCTOBER = new Date(Date.UTC(2026, 9, 15, 12));
const firstOrganization = newId();
const secondOrganization = newId();

describe('JudgingCharges.chargeRun', () => {
  let replSet: TestMongo;
  const Problems = mongoose.model('JudgingChargeProblemSpec', ProblemSchema);
  const Submissions = mongoose.model(
    'JudgingChargeSubmissionSpec',
    SubmissionSchema,
  );
  const Charges = mongoose.model(
    'JudgingChargeSpec',
    OrganizationJudgingChargeSchema,
  );
  const settings = {
    get: (key: string) => (key === 'site.timeZone' ? TIME_ZONE : undefined),
  } as unknown as SettingsService;
  const charges = new JudgingCharges(settings, Problems, Submissions, Charges);

  const seedProblem = async (fields: object = {}) =>
    (
      await Problems.create({
        code: `charge${newId().slice(-8)}`,
        name: 'Charged',
        timeLimit: 1,
        memoryLimit: 262144,
        points: 1000,
        typeIds: [newId()],
        groupId: newId(),
        isOrganizationPrivate: true,
        organizations: [firstOrganization, secondOrganization],
        ...fields,
      })
    )._id;
  const caseOf = (
    time: number,
    juryTime?: number,
  ): Partial<SubmissionCase> => ({
    position: 1,
    status: 'AC',
    time,
    ...(juryTime !== undefined && { juryTime }),
  });
  const seedRun = async (
    problem: string,
    cases: Partial<SubmissionCase>[],
    fields: object = {},
  ) =>
    (
      await Submissions.create({
        user: newId(),
        problem,
        language: newId(),
        status: 'D',
        result: 'AC',
        judgeGeneration: 1,
        judgedOn: 'judge-1',
        cases,
        ...fields,
      })
    )._id;
  const charge = (submissionId: string, problemId: string, now = OCTOBER) =>
    charges.chargeRun({ submissionId, problemId }, now);
  const rowsOf = async (submission: string) =>
    (await Charges.find({ submission }).sort({ generation: 1 }).lean()).map(
      (row) => ({
        organization: uuidStr(row.organization),
        month: row.month,
        generation: row.generation,
        status: row.status,
        ms: row.ms,
      }),
    );

  beforeAll(async () => {
    replSet = await startMongo();
    await mongoose.connect(replSet.getUri());
    await Promise.all(
      [Problems, Submissions, Charges].map((model) => model.syncIndexes()),
    );
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  it('charges the solution and jury time of every case, in ms, to the first listed organization only', async () => {
    const problem = await seedProblem();
    const run = await seedRun(problem, [caseOf(0.5, 0.25), caseOf(1.0)]);
    // a case stored before `juryTime` existed has no such field
    await mongoose.connection
      .db!.collection<{ _id: UUID }>(Submissions.collection.name)
      .updateOne({ _id: toUuid(run) }, { $unset: { 'cases.1.juryTime': '' } });
    await expect(charge(run, problem)).resolves.toEqual({
      organizationId: firstOrganization,
      month: '2026-10',
    });
    expect(await rowsOf(run)).toEqual([
      {
        organization: firstOrganization,
        month: '2026-10',
        generation: 1,
        status: 'D',
        ms: 1750,
      },
    ]);
    expect(
      await Charges.countDocuments({ organization: secondOrganization }),
    ).toBe(0);
  });

  it('rounds the sum to the nearest ms', async () => {
    const problem = await seedProblem();
    const rounded = await seedRun(problem, [caseOf(0.0012), caseOf(0.0004)]);
    await charge(rounded, problem);
    expect((await rowsOf(rounded)).map((row) => row.ms)).toEqual([2]);
  });

  it.each([
    ['a run that rounds to 0 ms', [caseOf(0.0004)], {}],
    [
      'a compile error, which stores no case',
      [],
      { status: 'CE', result: 'CE' },
    ],
  ])('writes nothing for %s', async (_name, cases, fields) => {
    const problem = await seedProblem();
    const run = await seedRun(problem, cases, fields);
    await expect(charge(run, problem)).resolves.toBeNull();
    expect(await rowsOf(run)).toEqual([]);
  });

  it('takes the month in the site time zone when the charge is recorded', async () => {
    const problem = await seedProblem();
    const run = await seedRun(problem, [caseOf(1)]);
    // 06:30 on 1 November in Asia/Ho_Chi_Minh
    await charge(run, problem, new Date(Date.UTC(2026, 9, 31, 23, 30)));
    expect((await rowsOf(run)).map((row) => row.month)).toEqual(['2026-11']);
  });

  it('charges a run whose grading began within a week, and not an older one that an api action re-sent', async () => {
    const problem = await seedProblem();
    const daysBefore = (days: number) =>
      new Date(OCTOBER.getTime() - days * 86_400_000);
    const recent = await seedRun(problem, [caseOf(1)], {
      judgedDate: daysBefore(6),
    });
    // graded before the meter existed; a score override sends its graded job again
    const stale = await seedRun(problem, [caseOf(1)], {
      judgedDate: daysBefore(8),
    });
    await charge(recent, problem);
    await expect(charge(stale, problem)).resolves.toBeNull();
    expect((await rowsOf(recent)).map((row) => row.ms)).toEqual([1000]);
    expect(await rowsOf(stale)).toEqual([]);
  });

  it('charges a grading attempt once however often its job runs, and a new generation again', async () => {
    const problem = await seedProblem();
    const run = await seedRun(problem, [caseOf(1)]);
    await charge(run, problem);
    await expect(charge(run, problem)).resolves.toBeNull();
    expect((await rowsOf(run)).map((row) => row.ms)).toEqual([1000]);
    await Submissions.updateOne(
      { _id: run },
      { $set: { judgeGeneration: 2, cases: [caseOf(0.3)] } },
    );
    await charge(run, problem);
    expect((await rowsOf(run)).map((row) => [row.generation, row.ms])).toEqual([
      [1, 1000],
      [2, 300],
    ]);
  });

  it.each([
    ['an aborted run', 'AB'],
    ['a run the judge ended with an internal error', 'IE'],
  ])('charges the cases %s stored before it stopped', async (_name, status) => {
    const problem = await seedProblem();
    const run = await seedRun(problem, [caseOf(0.2), caseOf(0.2)], {
      status,
      result: status,
    });
    await charge(run, problem);
    expect(await rowsOf(run)).toMatchObject([{ status, ms: 400 }]);
  });

  it.each([
    ['a queued run', { status: 'QU', result: null }],
    ['a run being graded', { status: 'G', result: null }],
    ['a rejected run', { result: 'RJ' }],
    ['a run of the external judge', { judgedOn: EXTERNAL_JUDGE_NAME }],
  ])('charges nothing for %s', async (_name, fields) => {
    const problem = await seedProblem();
    const run = await seedRun(problem, [caseOf(1, 1)], fields);
    await expect(charge(run, problem)).resolves.toBeNull();
    expect(await rowsOf(run)).toEqual([]);
  });

  it.each([
    ['a site problem', { isOrganizationPrivate: false }],
    [
      'an organization-private problem with no organization',
      { organizations: [] },
    ],
  ])('charges nothing for %s', async (_name, fields) => {
    const problem = await seedProblem(fields);
    const run = await seedRun(problem, [caseOf(1)]);
    await expect(charge(run, problem)).resolves.toBeNull();
    expect(await rowsOf(run)).toEqual([]);
  });

  it('charges nothing for a problem or a submission that no longer exists', async () => {
    const problem = await seedProblem();
    const run = await seedRun(problem, [caseOf(1)]);
    await expect(charge(run, newId())).resolves.toBeNull();
    await expect(charge(newId(), problem)).resolves.toBeNull();
    expect(await rowsOf(run)).toEqual([]);
  });
});
