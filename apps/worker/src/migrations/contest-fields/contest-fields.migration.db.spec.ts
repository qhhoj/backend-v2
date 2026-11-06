import { UUID } from 'mongodb';
import type { Document } from 'mongodb';
import { Contest } from '@libs/database';
import { setupMigrationsTest } from '../../../test/migrations-setup';
import type { MigrationsTest } from '../../../test/migrations-setup';
import { ContestFieldsMigration } from './contest-fields.migration';

/** The schema defaults of the fields the migration fills (`contest.schema.ts`). */
const DEFAULTS = {
  publishAfterEnd: false,
  publishAfterEndBy: null,
  autoPublishOutcome: null,
  organizations: [],
  isVisible: false,
  isPrivate: false,
  isOrganizationPrivate: false,
  rules: '',
  rulesHtml: '',
  rulesRevision: 0,
};
const ENDED = new Date('2026-10-01T00:00:00Z');
const NOW = new Date('2026-11-06T00:00:00Z');
const STORED_AT = new Date('2020-01-01T00:00:00Z');

/** The reads that still accept a missing field, as Mongo filters: the publish sweep, the editor's organization guard and its rules guard. */
const TOLERANT_READS = {
  due: {
    publishAfterEnd: true,
    autoPublishOutcome: null,
    endTime: { $lte: NOW },
  },
  unchangedOrganizations: {
    'organizations.0': { $exists: false },
    isOrganizationPrivate: { $ne: true },
  },
  notPrivate: { isPrivate: { $ne: true }, isVisible: { $ne: true } },
  noRules: { rules: { $in: ['', null] } },
};
/** The same reads once no row lacks a field (what L24 may write). */
const STRICT_READS = {
  due: {
    publishAfterEnd: true,
    autoPublishOutcome: null,
    endTime: { $lte: NOW },
  },
  unchangedOrganizations: { organizations: [], isOrganizationPrivate: false },
  notPrivate: { isPrivate: false, isVisible: false },
  noRules: { rules: '' },
};

describe('contest fields migration', () => {
  let test: MigrationsTest;

  beforeAll(async () => {
    test = await setupMigrationsTest();
  });
  afterAll(() => test.teardown());

  const contest = (key: string, fields: Document = {}): Document => ({
    _id: new UUID(),
    key,
    name: key,
    formatName: 'icpc',
    startTime: new Date('2026-09-30T00:00:00Z'),
    endTime: ENDED,
    updatedAt: STORED_AT,
    ...fields,
  });
  const matching = async (filters: Record<string, Document>) => {
    const contests = test.model<Contest>(Contest.name).collection;
    const ids: Record<string, string[]> = {};
    for (const [read, filter] of Object.entries(filters))
      ids[read] = (await contests.find(filter).sort({ _id: 1 }).toArray()).map(
        (row) => String(row.key),
      );
    return ids;
  };

  it('fills each missing field with its default, keeps every stored value, reads the same before and after, and a second run changes nothing', async () => {
    const legacy = [
      contest('bare'),
      contest('auto-publish', { publishAfterEnd: true }),
      contest('half', { isVisible: true, rules: 'Be nice', rulesRevision: 2 }),
    ];
    const current = [
      contest('defaults', DEFAULTS),
      contest('published', {
        ...DEFAULTS,
        publishAfterEnd: true,
        publishAfterEndBy: new UUID(),
        autoPublishOutcome: { at: NOW, status: 'published', reason: '' },
        organizations: [new UUID()],
        isOrganizationPrivate: true,
        rules: 'Rules',
        rulesHtml: '<p>Rules</p>',
        rulesRevision: 3,
      }),
    ];
    const contests = test.model<Contest>(Contest.name).collection;
    await contests.insertMany([...legacy, ...current]);
    const stored = await test.stored(Contest.name);
    const hydrated = await test.hydrated(Contest.name);
    const tolerant = await matching(TOLERANT_READS);
    const migration = test.module.get(ContestFieldsMigration);

    expect(await migration.run()).toBe(legacy.length);

    const legacyIds = new Set(legacy.map((row) => String(row._id)));
    expect(await test.stored(Contest.name)).toEqual(
      stored.map((row) =>
        legacyIds.has(String(row._id)) ? { ...DEFAULTS, ...row } : row,
      ),
    );
    expect(await test.hydrated(Contest.name)).toEqual(hydrated);
    expect(await matching(TOLERANT_READS)).toEqual(tolerant);
    expect(await matching(STRICT_READS)).toEqual(tolerant);
    expect(tolerant.due).toEqual(['auto-publish']);

    const after = await test.stored(Contest.name);
    expect(await migration.run()).toBe(0);
    expect(await test.stored(Contest.name)).toEqual(after);
  });
});
