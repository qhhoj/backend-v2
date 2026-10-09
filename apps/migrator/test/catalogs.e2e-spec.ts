import { uuidStr } from '@libs/database';
import { MigrationService } from '../src/migration.service';
import { setupMigratorTest } from './setup';

const JOBS = [
  'problem-types',
  'problem-groups',
  'licenses',
  'tag-groups',
  'tags',
  'tag-problems',
  'languages',
];

type Doc = Record<string, unknown>;

describe('catalog jobs', () => {
  let harness: Awaited<ReturnType<typeof setupMigratorTest>>;
  const docOf = async (collection: string, table: string, legacyId: number) =>
    (await harness.docOf(collection, table, legacyId)) as Doc | null;
  let migration: MigrationService;
  let reports: Record<string, string[]>;

  beforeAll(async () => {
    harness = await setupMigratorTest();
    migration = harness.testingModule.get(MigrationService);
    reports = await migration.backfill(JOBS);
  });
  afterAll(() => harness.teardown());

  it('copies the small catalogs field by field', async () => {
    expect(
      await docOf('problemTypes', 'judge_problemtype', 3001),
    ).toMatchObject({ name: 'dp', fullName: 'Dynamic programming' });
    expect(
      await docOf('problemGroups', 'judge_problemgroup', 3001),
    ).toMatchObject({ name: 'basic', fullName: 'Basic problems' });
    expect(await docOf('licenses', 'judge_license', 3001)).toMatchObject({
      key: 'cc-by',
      name: 'CC BY',
      link: 'https://cc.example/by',
      icon: 'i.png',
    });
    expect(await docOf('tagGroups', 'judge_taggroup', 3001)).toMatchObject({
      code: 'algo',
      name: 'Algorithms',
    });
  });

  it('links tags to their group and skips a tag whose group is gone', async () => {
    const tag = (await docOf('tags', 'judge_tag', 3001))!;
    expect(uuidStr(tag.groupId)).toBe(
      uuidStr(await harness.uuidOf('judge_taggroup', 3001)),
    );
    expect(await docOf('tags', 'judge_tag', 3002)).toBeNull();
    expect(reports.tags).toContain('skipped judge_tag:3002 (group missing)');
  });

  it('embeds tag assignments, leaving out skipped tags and missing assigners', async () => {
    const problem = (await docOf('tagProblems', 'judge_tagproblem', 3001))!;
    expect(problem).toMatchObject({ code: 'CF1A', judge: 'codeforces' });
    expect(
      (problem.tags as { tagId: unknown; assignerId: unknown }[]).map((tag) => [
        uuidStr(tag.tagId),
        uuidStr(tag.assignerId),
      ]),
    ).toEqual([
      [
        uuidStr(await harness.uuidOf('judge_tag', 3001)),
        uuidStr(await harness.uuidOf('auth_user', 1)),
      ],
    ]);
    expect(
      (await docOf('tagProblems', 'judge_tagproblem', 3002))!.judge,
    ).toBeNull();
    expect(reports['tag-problems']).toContain('dangling judge_profile:3999');
  });

  it('copies languages, nullable short names included', async () => {
    expect(await docOf('languages', 'judge_language', 12)).toMatchObject({
      key: 'SCRATCH',
      extension: 'sb3',
      fileOnly: true,
      fileSizeLimit: 1,
    });
    expect(await docOf('languages', 'judge_language', 5)).toMatchObject({
      key: 'C',
      shortName: null,
      commonName: 'C',
    });
  });

  it('verifies clean', async () => {
    expect(await migration.verify(JOBS)).toBe(0);
  });
});
