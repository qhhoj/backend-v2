import { MAPPERS, Mapper } from '../src/mapper';
import { MigrationService } from '../src/migration.service';
import { SKIPPED_TABLES } from '../src/skipped-tables';
import { setupMigratorTest } from './setup';

/** Every v2 collection with a legacy source (plan: coverage table). `ratings` is not here: the worker's rating replay writes it (D3). */
const COLLECTIONS = [
  'groups',
  'users',
  'organizations',
  'organizationRequests',
  'problemTypes',
  'problemGroups',
  'licenses',
  'tagGroups',
  'tags',
  'tagProblems',
  'languages',
  'problems',
  'contests',
  'contestAnnouncements',
  'contestPublicRankingLinks',
  'contestOfficialRankings',
  'contestParticipations',
  'contestSubmissions',
  'submissions',
  'submissionSources',
  'comments',
  'commentVotes',
  'commentLocks',
  'blogPosts',
  'blogVotes',
  'generalIssues',
  'tickets',
  'flatpages',
  'miscConfig',
  'navigationBar',
];

describe('full migration pipeline', () => {
  let harness: Awaited<ReturnType<typeof setupMigratorTest>>;
  let migration: MigrationService;

  beforeAll(async () => {
    harness = await setupMigratorTest();
    migration = harness.testingModule.get(MigrationService);
    await migration.backfill();
  });
  afterAll(() => harness.teardown());

  it('registers one job per v2 collection, each with documents', async () => {
    const mappers = harness.testingModule.get<Mapper[]>(MAPPERS);
    expect(mappers.map((mapper) => mapper.collection).sort()).toEqual(
      [...COLLECTIONS].sort(),
    );
    expect(new Set(mappers.map((mapper) => mapper.name)).size).toBe(
      mappers.length,
    );
    for (const collection of COLLECTIONS)
      expect(
        await harness.db.collection(collection).countDocuments(),
      ).toBeGreaterThan(0);
  });

  it('reads no table it lists as skipped by decision (badges, legacy ratings, logs)', () => {
    const read = new Set(
      harness.testingModule
        .get<Mapper[]>(MAPPERS)
        .flatMap((mapper) => mapper.refTables),
    );
    expect(SKIPPED_TABLES.filter(({ table }) => read.has(table))).toEqual([]);
  });

  it('verifies clean across every job, every seed loaded together', async () => {
    expect(await migration.verify()).toBe(0);
  });

  it('keeps every id on a re-run and builds no id map for log tables', async () => {
    const entries = harness.db.collection('migrationIdMap');
    const before = await entries
      .find()
      .sort({ table: 1, legacyId: 1 })
      .toArray();
    await migration.backfill();
    expect(
      await entries.find().sort({ table: 1, legacyId: 1 }).toArray(),
    ).toEqual(before);
    expect(
      await entries.countDocuments({
        table: {
          $in: [
            'judge_useractivity',
            'judge_usersession',
            'judge_submissiontestcase',
            'reversion_version',
          ],
        },
      }),
    ).toBe(0);
  });

  it('catches up new and changed legacy rows; a legacy delete needs --fresh', async () => {
    await harness.mysql.query(
      `UPDATE ${harness.name}.judge_problem SET name = 'Renamed' WHERE id = 7001;
       INSERT INTO ${harness.name}.judge_submission (id, date, status, result, case_points, case_total, problem_id, user_id, language_id) VALUES (7100, NOW(), 'D', 'AC', 1, 1, 7001, 1, 4);
       INSERT INTO ${harness.name}.judge_submissiontestcase (id, \`case\`, status, submission_id) VALUES (7100, 1, 'AC', 7100);
       INSERT INTO ${harness.name}.judge_submissionsource (id, source, submission_id) VALUES (7100, 'x', 7100);
       DELETE FROM ${harness.name}.judge_blogvote WHERE id = 8001;`,
    );
    await migration.backfill();
    expect(
      (
        (await harness.docOf('problems', 'judge_problem', 7001)) as {
          name?: string;
        }
      ).name,
    ).toBe('Renamed');
    expect(
      (
        (await harness.docOf('submissions', 'judge_submission', 7100)) as {
          cases?: unknown[];
        }
      ).cases,
    ).toHaveLength(1);
    expect(await migration.verify(['blog-votes'])).toBe(1);
    await migration.backfill(['blog-votes'], true);
    expect(await migration.verify()).toBe(0);
  });
});
