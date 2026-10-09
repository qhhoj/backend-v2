import { uuidStr } from '@libs/database';
import type { Problem } from '@libs/database';
import { MigrationService } from '../src/migration.service';
import { setupMigratorTest } from './setup';

describe('problems job', () => {
  let harness: Awaited<ReturnType<typeof setupMigratorTest>>;
  let migration: MigrationService;
  let reports: Record<string, string[]>;
  const problem = async (id: number) =>
    (await harness.docOf('problems', 'judge_problem', id)) as unknown as
      (Problem & { _id: string }) | null;
  const ids = async (table: string, legacyIds: number[]) =>
    Promise.all(
      legacyIds.map(async (id) => uuidStr(await harness.uuidOf(table, id))),
    );

  beforeAll(async () => {
    harness = await setupMigratorTest();
    migration = harness.testingModule.get(MigrationService);
    reports = await migration.backfill(['problems']);
  });
  afterAll(() => harness.teardown());

  it('maps scalar fields and renders the statement with math', async () => {
    expect(await problem(4001)).toMatchObject({
      code: 'sum4',
      name: 'Sum',
      timeLimit: 1,
      memoryLimit: 262144,
      points: 1000,
      partial: true,
      isPublic: true,
      source: 'VOI',
      descriptionHtml: expect.stringMatching(
        /katex[\s\S]*<strong>nhanh<\/strong>/,
      ) as unknown,
      materialUrl: '/media/problem_materials/sum4.pdf',
      pdfStatementUrl: null,
      date: new Date('2021-01-01T00:00:00Z'),
      dataVersion: 0,
      dataBytes: 0,
    });
    expect((await problem(4002))!.pdfStatementUrl).toBe(
      'https://cdn.example/p.pdf',
    );
  });

  it('stores every migrated problem live: no soft-delete key at all', async () => {
    const stored = await problem(4001);
    for (const key of ['deletedAt', 'deletedBy', 'purgeStartedAt', 'purgedAt'])
      expect(stored).not.toHaveProperty(key);
  });

  it('puts a bare pdf path under MEDIA_URL and keeps http(s) and site paths', async () => {
    expect((await problem(4005))!.pdfStatementUrl).toBe(
      '/media/statements/low.pdf',
    );
    expect((await problem(4006))!.pdfStatementUrl).toBe('/static/high.pdf');
  });

  it('resolves relations to v2 ids (profiles to users)', async () => {
    const sum = (await problem(4001))!;
    expect(sum.typeIds.map(uuidStr)).toEqual(
      await ids('judge_problemtype', [4001]),
    );
    expect(sum.authors.map(uuidStr)).toEqual(await ids('auth_user', [1]));
    expect(sum.curators.map(uuidStr)).toEqual(await ids('auth_user', [2]));
    expect(sum.organizations.map(uuidStr)).toEqual(
      await ids('judge_organization', [1]),
    );
    expect(sum.allowedLanguages.map(uuidStr)).toEqual(
      await ids('judge_language', [4, 5]),
    );
    expect(
      sum.languageLimits.map(
        (limit: {
          languageId: unknown;
          timeLimit: number;
          memoryLimit: number;
        }) => [uuidStr(limit.languageId), limit.timeLimit, limit.memoryLimit],
      ),
    ).toEqual([[(await ids('judge_language', [9]))[0], 2, 524288]]);
    expect(uuidStr(sum.suggester)).toBe((await ids('auth_user', [1]))[0]);
    expect(sum.mirrorOf).toBeNull();
    // 4003 exists in legacy (so in the id map) but is skipped: the mirror must not point at it.
    expect((await problem(4002))!.mirrorRoot).toBeNull();
  });

  it('keeps en/vi translations and the editorial, rendered', async () => {
    const sum = (await problem(4001))!;
    expect(sum.translations).toEqual([
      {
        language: 'en',
        name: 'Sum',
        description: 'Add *two*',
        descriptionHtml: expect.stringContaining('<em>two</em>') as unknown,
      },
    ]);
    expect(sum.solution).toMatchObject({
      isPublic: true,
      publishOn: new Date('2021-02-01T00:00:00Z'),
      content: 'Use **long long**',
      contentHtml: expect.stringContaining(
        '<strong>long long</strong>',
      ) as unknown,
    });
    expect(sum.solution!.authors.map(uuidStr)).toEqual(
      await ids('auth_user', [1]),
    );
  });

  it('skips a problem without a group and reports what it dropped', async () => {
    expect(await problem(4003)).toBeNull();
    expect(reports.problems).toEqual(
      expect.arrayContaining([
        'skipped judge_problem:4003 (group missing)',
        'dropped translation fr of judge_problem:4001',
        'dangling judge_problem:4999',
        'dangling judge_problem:4003',
      ]),
    );
  });

  it('clamps points into 800..3500 and reports each clamped problem', async () => {
    expect((await problem(4005))!.points).toBe(800);
    expect((await problem(4006))!.points).toBe(3500);
    expect(reports.problems).toEqual(
      expect.arrayContaining([
        'clamped points judge_problem:4005 100 -> 800',
        'clamped points judge_problem:4006 9000 -> 3500',
      ]),
    );
    expect(
      reports.problems.some((line) => line.includes('judge_problem:4001 ')),
    ).toBe(false);
  });

  it('embeds data with bare file names, rstripped as standard, and ordered cases', async () => {
    const sum = (await problem(4001))!;
    expect(sum.data).toMatchObject({
      archive: 'tests.zip',
      customChecker: 'check.cpp',
      generator: null,
      checker: 'floats',
      checkerArgs: { precision: 6 },
      unicode: true,
      feedback: '',
    });
    expect(
      sum.data!.cases.map((testCase) => [
        testCase.input,
        testCase.checker,
        testCase.isPretest,
        testCase.points,
      ]),
    ).toEqual([
      ['1.in', 'identical', true, 40],
      ['2.in', '', false, 60],
      ['3.in', 'standard', false, 0],
    ]);
    expect(
      reports.problems.some((line) =>
        line.startsWith('judge_problemtestcase:4003'),
      ),
    ).toBe(false);
    expect((await problem(4002))!.data).toBeNull();
  });

  it('fails the data of a problem with an unsupported checker instead of falling back', async () => {
    const sorted = (await problem(4004))!;
    expect(sorted).toMatchObject({ code: 'sorted4', data: null });
    expect(reports.problems).toEqual(
      expect.arrayContaining([
        'judge_problemdata:4002 checker "sorted" unsupported',
        'judge_problemdata:4002 file outside sorted4/',
      ]),
    );
  });

  it('verifies clean', async () => {
    expect(await migration.verify(['problems'])).toBe(0);
  });
});
