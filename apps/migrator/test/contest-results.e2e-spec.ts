import { uuidStr } from '@libs/database';
import { MigrationService } from '../src/migration.service';
import { setupMigratorTest } from './setup';

const JOBS = ['contest-participations', 'contest-submissions'];

type Doc = Record<string, unknown>;

describe('contest result jobs', () => {
  let harness: Awaited<ReturnType<typeof setupMigratorTest>>;
  let migration: MigrationService;
  const docOf = async (collection: string, table: string, legacyId: number) =>
    (await harness.docOf(collection, table, legacyId)) as Doc | null;
  const id = async (table: string, legacyId: number) =>
    uuidStr(await harness.uuidOf(table, legacyId));

  beforeAll(async () => {
    harness = await setupMigratorTest();
    migration = harness.testingModule.get(MigrationService);
    await migration.backfill(JOBS);
  });
  afterAll(() => harness.teardown());

  it('maps live, registered and virtual participations; cells wait for the recompute', async () => {
    const live = (await docOf(
      'contestParticipations',
      'judge_contestparticipation',
      6001,
    ))!;
    expect(live).toMatchObject({
      realStart: new Date('2023-01-01T00:10:00Z'),
      virtual: 0,
      score: 100,
      cumtime: 600,
      isRegistered: false,
      rulesAcceptedAt: null,
      rulesAcceptedRevision: null,
      formatData: {},
      frozenFormatData: {},
    });
    expect(uuidStr(live.user)).toBe(await id('auth_user', 1));
    expect(uuidStr(live.contest)).toBe(await id('judge_contest', 6001));
    expect(
      await docOf('contestParticipations', 'judge_contestparticipation', 6002),
    ).toMatchObject({ isRegistered: true, createdAt: null, updatedAt: null });
    expect(
      await docOf('contestParticipations', 'judge_contestparticipation', 6004),
    ).toMatchObject({ virtual: 1, isRegistered: false });
    expect(
      await docOf('contestParticipations', 'judge_contestparticipation', 6003),
    ).toBeNull();
  });

  it("keys a contest submission by its submission's id and keeps legacy points", async () => {
    const row = (await docOf('contestSubmissions', 'judge_submission', 6001))!;
    expect(row).toMatchObject({ points: 100, isPretest: false });
    expect(uuidStr(row.participation)).toBe(
      await id('judge_contestparticipation', 6001),
    );
    expect(uuidStr(row.problem)).toBe(await id('judge_problem', 6001));
    expect(
      await docOf('contestSubmissions', 'judge_submission', 6002),
    ).toBeNull();
  });

  it('registers no ratings job (legacy ratings are re-rated by the worker, not copied)', async () => {
    await expect(migration.backfill(['ratings'])).rejects.toThrow(
      'unknown job: ratings',
    );
  });

  it('verifies clean', async () => {
    expect(await migration.verify(JOBS)).toBe(0);
  });
});
