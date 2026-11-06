import { UUID } from 'mongodb';
import type { Document } from 'mongodb';
import { ContestParticipation } from '@libs/database';
import { setupMigrationsTest } from '../../../test/migrations-setup';
import type { MigrationsTest } from '../../../test/migrations-setup';
import { ParticipationRulesFieldsMigration } from './participation-rules-fields.migration';

const DEFAULTS = { rulesAcceptedAt: null, rulesAcceptedRevision: null };

describe('participation rules fields migration', () => {
  let test: MigrationsTest;

  beforeAll(async () => {
    test = await setupMigrationsTest();
  });
  afterAll(() => test.teardown());

  /** A scored participation: the migration must leave its score, time and cells as stored. */
  const participation = (fields: Document = {}): Document => ({
    _id: new UUID(),
    contest: new UUID(),
    user: new UUID(),
    virtual: 0,
    score: 250.5,
    cumtime: 1234,
    tiebreaker: 7,
    formatData: { p1: { points: 100, time: 60 } },
    isDisqualified: false,
    updatedAt: null,
    ...fields,
  });
  /** The join's staleness input: `rulesAcceptedRevision ?? -1`. */
  const acceptedRevisions = async () =>
    (await test.stored(ContestParticipation.name)).map(
      (row) => (row.rulesAcceptedRevision as number | null | undefined) ?? -1,
    );

  it('stores "no rules asked" on rows from before rules, keeps scores and accepted revisions, reads the same, and a second run changes nothing', async () => {
    const legacy = [participation(), participation({ virtual: 1 })];
    const current = [
      participation(DEFAULTS),
      participation({ rulesAcceptedAt: new Date(), rulesAcceptedRevision: 2 }),
    ];
    await test
      .model(ContestParticipation.name)
      .collection.insertMany([...legacy, ...current]);
    const stored = await test.stored(ContestParticipation.name);
    const hydrated = await test.hydrated(ContestParticipation.name);
    const revisions = await acceptedRevisions();
    const migration = test.module.get(ParticipationRulesFieldsMigration);

    expect(await migration.run()).toBe(legacy.length);

    const legacyIds = new Set(legacy.map((row) => String(row._id)));
    expect(await test.stored(ContestParticipation.name)).toEqual(
      stored.map((row) =>
        legacyIds.has(String(row._id)) ? { ...DEFAULTS, ...row } : row,
      ),
    );
    expect(await test.hydrated(ContestParticipation.name)).toEqual(hydrated);
    expect(await acceptedRevisions()).toEqual(revisions);
    expect(
      await test.model(ContestParticipation.name).collection.countDocuments({
        rulesAcceptedRevision: { $exists: false },
      }),
    ).toBe(0);

    const after = await test.stored(ContestParticipation.name);
    expect(await migration.run()).toBe(0);
    expect(await test.stored(ContestParticipation.name)).toEqual(after);
  });
});
