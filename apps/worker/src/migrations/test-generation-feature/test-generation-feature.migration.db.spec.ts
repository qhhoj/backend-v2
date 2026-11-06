import { ObjectId, UUID } from 'mongodb';
import type { Document } from 'mongodb';
import { TestGeneration } from '@libs/database';
import { setupMigrationsTest } from '../../../test/migrations-setup';
import type { MigrationsTest } from '../../../test/migrations-setup';
import { TestGenerationFeatureMigration } from './test-generation-feature.migration';

describe('test generation feature migration', () => {
  let test: MigrationsTest;

  beforeAll(async () => {
    test = await setupMigrationsTest();
  });
  afterAll(() => test.teardown());

  /** A generation in any state: the migration must leave its plan, status, judge and result as stored. */
  const generation = (status: string, fields: Document = {}): Document => ({
    _id: new UUID(),
    status,
    plan: { tests: [{ input: 'gen 1' }], timeLimit: 2 },
    bundleFileId: new ObjectId(),
    bundleSize: 512,
    resultFileId: status === 'done' ? new ObjectId() : null,
    judge: status === 'queued' ? null : 'judge-1',
    updatedAt: new Date('2026-10-11T00:00:00Z'),
    ...fields,
  });
  /** What the bridge hands a judge: `feature ?? 'generate.polygon'` per queued row. */
  const queuedFeatures = async () =>
    (
      await test
        .model(TestGeneration.name)
        .collection.find({ status: 'queued' })
        .sort({ _id: 1 })
        .toArray()
    ).map((row) => [
      String(row._id),
      (row.feature as string | undefined) ?? 'generate.polygon',
    ]);

  it('stores test generation as the feature of rows from before compile checks, changes no other field, reads the same, and a second run changes nothing', async () => {
    const legacy = [
      generation('queued'),
      generation('running'),
      generation('done'),
    ];
    const current = [
      generation('queued', { feature: 'generate.compile' }),
      generation('done', { feature: 'generate.polygon' }),
    ];
    await test
      .model(TestGeneration.name)
      .collection.insertMany([...legacy, ...current]);
    const stored = await test.stored(TestGeneration.name);
    const hydrated = await test.hydrated(TestGeneration.name);
    const queued = await queuedFeatures();
    const migration = test.module.get(TestGenerationFeatureMigration);

    expect(await migration.run()).toBe(legacy.length);

    const legacyIds = new Set(legacy.map((row) => String(row._id)));
    expect(await test.stored(TestGeneration.name)).toEqual(
      stored.map((row) =>
        legacyIds.has(String(row._id))
          ? { feature: 'generate.polygon', ...row }
          : row,
      ),
    );
    expect(await test.hydrated(TestGeneration.name)).toEqual(hydrated);
    expect(await queuedFeatures()).toEqual(queued);

    const after = await test.stored(TestGeneration.name);
    expect(await migration.run()).toBe(0);
    expect(await test.stored(TestGeneration.name)).toEqual(after);
  });
});
