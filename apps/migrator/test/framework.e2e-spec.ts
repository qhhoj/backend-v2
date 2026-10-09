import { getConnectionToken } from '@nestjs/mongoose';
import { uuidStr } from '@libs/database';
import { Connection } from 'mongoose';
import { IdMapRepository } from '../src/id-map.repository';
import { LegacySourceService } from '../src/legacy-source.service';
import { Mapper } from '../src/mapper';
import { MigrationService } from '../src/migration.service';
import { setupMigratorTest } from './setup';

type Group = { id: number; code: string; name: string };
type Tag = { id: number; code: string; group_id: number };

/** A test-only job: tag groups with their tag codes merge-joined, `skip_*` skipped, a dangling ref reported, `name` unique (505 repeats 501's). */
const groupsWithTags: Mapper<Group, Tag> = {
  name: 'test-tag-groups',
  collection: 'testTagGroups',
  refTables: ['judge_taggroup', 'judge_tag'],
  sql: 'SELECT id, code, name FROM judge_taggroup WHERE id BETWEEN 500 AND 999 ORDER BY id',
  children: {
    sql: 'SELECT id, code, group_id FROM judge_tag WHERE id BETWEEN 500 AND 999 ORDER BY group_id',
    key: 'group_id',
  },
  map(row, ctx, tags) {
    if (row.code.startsWith('skip_')) {
      ctx.report(`skipped judge_taggroup:${row.id}`);
      return null;
    }
    return {
      _id: ctx.ref('judge_taggroup', row.id)!,
      name: row.name,
      tags: tags.map((tag) => tag.code),
      missing: ctx.refOrNull('judge_taggroup', 777),
      html: ctx.render('**x**', 'user', `judge_taggroup:${row.id}`),
    };
  },
};

describe('migrator framework extensions', () => {
  let harness: Awaited<ReturnType<typeof setupMigratorTest>>;
  let migration: MigrationService;
  let reports: Record<string, string[]>;

  beforeAll(async () => {
    harness = await setupMigratorTest();
    const module = harness.testingModule;
    migration = new MigrationService(
      [groupsWithTags],
      module.get<Connection>(getConnectionToken()),
      module.get(LegacySourceService),
      module.get(IdMapRepository),
    );
    migration.batchSize = 2;
    await harness.db
      .collection('testTagGroups')
      .createIndex({ name: 1 }, { unique: true });
    reports = await migration.backfill();
  });
  afterAll(() => harness.teardown());

  it('attaches every child to its parent across batch boundaries', async () => {
    expect(
      await harness.docOf('testTagGroups', 'judge_taggroup', 501),
    ).toMatchObject({ tags: ['fw_t1', 'fw_t2'] });
    expect(
      await harness.docOf('testTagGroups', 'judge_taggroup', 503),
    ).toMatchObject({ tags: ['fw_t3'] });
    expect(
      await harness.docOf('testTagGroups', 'judge_taggroup', 504),
    ).toMatchObject({ tags: ['fw_t4', 'fw_t5', 'fw_t6'] });
  });

  it('skips a null-mapped row, clears and reports a dangling ref, renders markdown', async () => {
    expect(
      await harness.docOf('testTagGroups', 'judge_taggroup', 502),
    ).toBeNull();
    expect(
      await harness.docOf('testTagGroups', 'judge_taggroup', 501),
    ).toMatchObject({
      missing: null,
      html: expect.stringContaining('<strong>x</strong>') as unknown,
    });
    expect(reports['test-tag-groups']).toEqual(
      expect.arrayContaining([
        'skipped judge_taggroup:502',
        'dangling judge_taggroup:777 (x5)',
        '1 child row(s) after the last parent',
      ]),
    );
  });

  it('reports a duplicate-key row by uuid, keeps the rest of its batch and never quotes the key', async () => {
    const duplicate = uuidStr(await harness.uuidOf('judge_taggroup', 505));
    expect(reports['test-tag-groups']).toContain(
      `duplicate key testTagGroups ${duplicate}`,
    );
    expect(
      await harness.docOf('testTagGroups', 'judge_taggroup', 505),
    ).toBeNull();
    expect(
      await harness.docOf('testTagGroups', 'judge_taggroup', 506),
    ).not.toBeNull();
    expect(
      reports['test-tag-groups'].some((line) => line.includes('dup key')),
    ).toBe(false);
  });

  it('counts the refused row as the only verify failure; skipped rows count nothing', async () => {
    // 505: one mismatch (mapped, absent) plus the count line (5 mapped rows, 4 documents).
    expect(await migration.verify()).toBe(2);
  });
});
