import type { Model } from 'mongoose';
import { newId, Revision, Submission } from '@libs/database';
import { setupMigrationsTest } from '../../../test/migrations-setup';
import type { MigrationsTest } from '../../../test/migrations-setup';
import { IeOverrideCleanupMigration } from './ie-override-cleanup.migration';

const JURY_TEXT = "wrong answer: expected jury's 8 days";
const OVERRIDE_AT = new Date('2026-10-01T00:00:00Z');

describe('IE override cleanup migration', () => {
  let test: MigrationsTest;
  let revisions: Model<Revision>;
  let submissions: Model<Submission>;
  let cleanup: IeOverrideCleanupMigration;

  beforeAll(async () => {
    test = await setupMigrationsTest();
    revisions = test.model(Revision.name);
    submissions = test.model(Submission.name);
    cleanup = test.module.get(IeOverrideCleanupMigration);
  });
  afterAll(() => test.teardown());

  /** A submission and its score-override revision from `before` to AC. */
  const overridden = async (
    row: Partial<Submission>,
    before: string,
  ): Promise<{ submissionId: string; revisionId: string }> => {
    const submissionId = newId();
    await submissions.create({
      _id: submissionId,
      user: newId(),
      problem: newId(),
      language: newId(),
      status: 'D',
      result: 'AC',
      judgedDate: new Date('2026-09-30T00:00:00Z'),
      ...row,
    });
    const [revision] = await revisions.create([
      {
        entity: 'submission',
        entityId: submissionId,
        action: 'override_score',
        changes: {
          result: { before, after: 'AC' },
          points: { before: 0, after: 100 },
        },
        createdAt: OVERRIDE_AT,
      },
    ]);
    return { submissionId, revisionId: revision._id };
  };

  const errorOf = async (id: string) =>
    (await submissions.findById(id).lean())!.error;
  const changesOf = async (id: string) =>
    (await revisions.findById(id).lean())!.changes;

  it('moves the message of an overridden internal error into its revision, once, and leaves other errors alone', async () => {
    const ie = await overridden({ error: JURY_TEXT }, 'IE');
    const warnings = await overridden({ error: 'warning: unused x' }, 'WA');
    const compileError = await overridden(
      { result: 'CE', status: 'CE', error: 'main.cpp:1: error' },
      'IE',
    );
    const regraded = await overridden(
      {
        error: 'warning: new build',
        judgedDate: new Date('2026-10-05T00:00:00Z'),
      },
      'IE',
    );
    const stillIe = await overridden(
      { status: 'IE', result: 'IE', error: JURY_TEXT },
      'IE',
    );

    expect(await cleanup.run()).toBe(1);

    expect(await errorOf(ie.submissionId)).toBeNull();
    expect((await changesOf(ie.revisionId)).error).toEqual({
      before: JURY_TEXT,
      after: null,
    });
    for (const untouched of [warnings, compileError, regraded, stillIe])
      expect((await changesOf(untouched.revisionId)).error).toBeUndefined();
    expect(await errorOf(warnings.submissionId)).toBe('warning: unused x');
    expect(await errorOf(compileError.submissionId)).toBe('main.cpp:1: error');
    expect(await errorOf(regraded.submissionId)).toBe('warning: new build');
    expect(await errorOf(stillIe.submissionId)).toBe(JURY_TEXT);

    const revisionsBefore = await revisions.find().sort({ _id: 1 }).lean();
    const rowsBefore = await submissions.find().sort({ _id: 1 }).lean();
    expect(await cleanup.run()).toBe(0);
    expect(await revisions.find().sort({ _id: 1 }).lean()).toEqual(
      revisionsBefore,
    );
    expect(await submissions.find().sort({ _id: 1 }).lean()).toEqual(
      rowsBefore,
    );
  });

  it('finishes a cleanup interrupted after the revision got its copy', async () => {
    const ie = await overridden({ error: JURY_TEXT }, 'IE');
    await revisions.updateOne(
      { _id: ie.revisionId },
      { $set: { 'changes.error': { before: JURY_TEXT, after: null } } },
    );

    expect(await cleanup.run()).toBe(1);

    expect(await errorOf(ie.submissionId)).toBeNull();
    expect((await changesOf(ie.revisionId)).error).toEqual({
      before: JURY_TEXT,
      after: null,
    });
  });
});
