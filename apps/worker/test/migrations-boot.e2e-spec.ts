import { MongoClient } from 'mongodb';
import type { Document, UUID } from 'mongodb';
import { newId, toUuid } from '@libs/database';
import { setupWorkerTest } from './setup';
import type { WorkerTest } from './setup';

/** One row of each shape a retired boot routine used to rewrite; `worker migrate` owns them now. */
const LEGACY_ROWS: Record<string, Document & { _id: UUID }> = {
  groups: {
    _id: toUuid(newId()),
    name: 'Setter',
    permissions: ['judge.import_polygon_package'],
  },
  contests: {
    _id: toUuid(newId()),
    key: 'legacy',
    name: 'Legacy',
    summary: '{"cumtime": true}',
    formatName: 'icpc',
    formatConfig: {},
  },
  users: {
    _id: toUuid(newId()),
    username: 'dormant',
    password: 'pbkdf2_sha256$1$s$h',
    isActive: false,
    dateJoined: new Date('2020-01-01T00:00:00Z'),
  },
  revisions: {
    _id: toUuid(newId()),
    entity: 'submission',
    entityId: toUuid(newId()),
    action: 'override_score',
    changes: { result: { before: 'IE', after: 'AC' } },
    createdAt: new Date('2026-10-01T00:00:00Z'),
  },
  problems: { _id: toUuid(newId()), code: 'legacy', dataBytes: 999 },
};

describe('worker boot', () => {
  let worker: WorkerTest;

  beforeAll(async () => {
    worker = await setupWorkerTest({
      seedBeforeBoot: async (mongoUri) => {
        const client = await MongoClient.connect(mongoUri);
        for (const [collection, row] of Object.entries(LEGACY_ROWS))
          await client
            .db()
            .collection<{ _id: UUID }>(collection)
            .insertOne({ ...row });
        await client.close();
      },
    });
  });
  afterAll(() => worker.teardown());

  it('runs no migration: legacy rows stay as stored and nothing is recorded', async () => {
    for (const [collection, row] of Object.entries(LEGACY_ROWS))
      expect(
        await worker.db
          .collection<{ _id: UUID }>(collection)
          .findOne({ _id: row._id }),
      ).toEqual(row);
    expect(await worker.db.collection('migrations').countDocuments()).toBe(0);
  });
});
