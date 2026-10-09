import { uuidStr } from '@libs/database';
import type { Submission, SubmissionCase } from '@libs/database';
import { MigrationService } from '../src/migration.service';
import { setupMigratorTest } from './setup';

describe('submissions job', () => {
  let harness: Awaited<ReturnType<typeof setupMigratorTest>>;
  let migration: MigrationService;
  let reports: Record<string, string[]>;
  const submission = async (id: number) =>
    (await harness.docOf('submissions', 'judge_submission', id)) as unknown as
      (Submission & { _id: string; cases: SubmissionCase[] }) | null;

  beforeAll(async () => {
    harness = await setupMigratorTest();
    migration = harness.testingModule.get(MigrationService);
    migration.batchSize = 1;
    reports = await migration.backfill(['submissions']);
  });
  afterAll(() => harness.teardown());

  it('copies grading totals and embedded cases in case order, without a judge name', async () => {
    const graded = (await submission(7001))!;
    expect(graded).toMatchObject({
      status: 'D',
      result: 'WA',
      casePoints: 1,
      caseTotal: 2.5,
      points: 400,
      judgedOn: null,
      priority: 1,
      requeueCount: 0,
      date: new Date('2023-03-01T10:00:00Z'),
    });
    expect(
      graded.cases.map((testCase) => [testCase.position, testCase.status]),
    ).toEqual([
      [1, 'AC'],
      [2, 'WA'],
    ]);
    expect(Buffer.byteLength(graded.cases[0].output)).toBeLessThanOrEqual(512);
    expect(uuidStr(graded.user)).toBe(
      uuidStr(await harness.uuidOf('auth_user', 1)),
    );
  });

  it('requeues in-flight submissions and nulls an empty result', async () => {
    expect(await submission(7002)).toMatchObject({
      status: 'QU',
      judgedOn: null,
      cases: [],
    });
    expect((await submission(7004))!.result).toBeNull();
  });

  it('leaves out submissions of skipped problems, and their cases', async () => {
    expect(await submission(7003)).toBeNull();
    expect(reports.submissions).toEqual(
      expect.arrayContaining([
        'judge_submission:7001 case status "ZZ" dropped',
        'judge_submission:7001 case status "RJ" dropped',
        'submissions: child rows of missing parent 7003',
      ]),
    );
  });

  it('time-stamps ids with the submission date', async () => {
    const id = uuidStr(await harness.uuidOf('judge_submission', 7001));
    expect(parseInt(id.replace(/-/g, '').slice(0, 12), 16)).toBe(
      Date.UTC(2023, 2, 1, 10),
    );
  });

  it('verifies clean', async () => {
    expect(await migration.verify(['submissions'])).toBe(0);
  });
});
