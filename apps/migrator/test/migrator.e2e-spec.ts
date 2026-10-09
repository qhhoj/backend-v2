import { newId, toUuid, uuidStr } from '@libs/database';
import { RowDataPacket } from 'mysql2/promise';
import { IdMapRepository } from '../src/id-map.repository';
import { MappedDocument } from '../src/mapper';
import { GrantPermissionsService } from '../src/grant-permissions.service';
import { MigrationService } from '../src/migration.service';
import { setupMigratorTest } from './setup';

describe('migrator framework', () => {
  let harness: Awaited<ReturnType<typeof setupMigratorTest>>;
  let migration: MigrationService;
  const groupIds = async () =>
    (
      await harness.db.collection('groups').find().sort({ name: 1 }).toArray()
    ).map((group) => uuidStr(group._id));

  beforeAll(async () => {
    harness = await setupMigratorTest();
    migration = harness.testingModule.get(MigrationService);
    await migration.backfill();
  });
  afterAll(() => harness.teardown());

  it('maps every legacy id to a uuid and aliases profiles to their user', async () => {
    const ids = harness.testingModule.get(IdMapRepository);
    await ids.build(['auth_user', 'judge_profile']);
    await ids.load(['auth_user', 'judge_profile']);
    const [rows] = await harness.mysql.query<RowDataPacket[]>(
      `SELECT id, user_id FROM ${harness.name}.judge_profile LIMIT 1`,
    );
    const row = rows[0] as { id: number; user_id: number };
    expect(ids.get('judge_profile', row.id)).toBe(
      ids.get('auth_user', row.user_id),
    );
    expect(() => ids.get('auth_user', 999999)).toThrow(/auth_user:999999/);
  });

  it('imports groups with permission codenames', async () => {
    const staff = await harness.db
      .collection('groups')
      .findOne({ name: 'Staff' });
    expect(staff).toMatchObject({ permissions: ['judge.edit_all_problem'] });
    expect(uuidStr(staff!._id)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('verifies clean, then detects tampering', async () => {
    expect(await migration.verify()).toBe(0);
    await harness.db
      .collection('groups')
      .updateOne({ name: 'Staff' }, { $set: { permissions: [] } });
    expect(await migration.verify()).toBe(1);
    await migration.backfill();
  });

  it('verifies clean after grant-permissions added v2-only codenames, and again after a rerun', async () => {
    const grant = harness.testingModule.get(GrantPermissionsService);
    expect(await grant.grant()).toMatchObject({ 'judge.delete_problem': 1 });
    expect(
      await harness.db.collection('groups').findOne({ name: 'Staff' }),
    ).toMatchObject({
      permissions: ['judge.edit_all_problem', 'judge.delete_problem'],
    });
    expect(await migration.verify()).toBe(0);
    await grant.grant();
    expect(await migration.verify()).toBe(0);
  });

  it('keeps ids stable and counts unchanged when re-run', async () => {
    const before = await groupIds();
    await migration.backfill();
    expect(await groupIds()).toEqual(before);
    expect(await harness.db.collection('groups').countDocuments()).toBe(2);
    expect(await migration.verify()).toBe(0);
  });

  it('catches up new legacy rows without changing existing ids', async () => {
    const before = await groupIds();
    await harness.mysql.query(
      `INSERT INTO ${harness.name}.auth_group (name) VALUES ('Late')`,
    );
    await migration.backfill();
    const after = await groupIds();
    expect(after).toHaveLength(3);
    expect(after).toEqual(expect.arrayContaining(before));
    expect(
      await harness.db.collection('groups').findOne({ name: 'Late' }),
    ).not.toBeNull();
    expect(await migration.verify()).toBe(0);
  });

  it('maps tables larger than one batch once each, stably across re-runs', async () => {
    await harness.mysql.query(
      `INSERT INTO ${harness.name}.judge_useractivity (timestamp, path, method, ip_address, user_agent, referer)
       WITH RECURSIVE seq (n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 110)
       SELECT NOW(), '/', 'GET', '127.0.0.1', '', '' FROM seq a, seq b`,
    );
    const [rows] = await harness.mysql.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM ${harness.name}.judge_useractivity`,
    );
    const entries = harness.db.collection('migrationIdMap');
    const snapshot = async () =>
      (
        await entries
          .find({ table: 'judge_useractivity' })
          .sort({ legacyId: 1 })
          .toArray()
      ).map((entry) => `${entry.legacyId}:${entry.id}`);
    const ids = harness.testingModule.get(IdMapRepository);
    await ids.build(['judge_useractivity']);
    const first = await snapshot();
    expect(first).toHaveLength(Number(rows[0].total));
    expect(new Set(first.map((entry) => entry.split(':')[1])).size).toBe(
      first.length,
    );
    await ids.build(['judge_useractivity']);
    expect(await snapshot()).toEqual(first);
  });

  it('selects jobs by name', async () => {
    await expect(migration.backfill(['groups'])).resolves.toEqual({
      groups: [],
    });
    await expect(migration.backfill(['nope'])).rejects.toThrow(
      'unknown job: nope',
    );
    await expect(migration.verify(['nope'])).rejects.toThrow(
      'unknown job: nope',
    );
  });

  it('--fresh empties the job collection before writing', async () => {
    const groups = harness.db.collection<MappedDocument>('groups');
    await groups.updateOne({ name: 'Staff' }, { $set: { permissions: [] } });
    await groups.insertOne({
      _id: toUuid(newId()),
      name: 'Stray',
      permissions: [],
    });
    await migration.backfill(['groups']);
    expect(await groups.findOne({ name: 'Stray' })).not.toBeNull();
    expect(await migration.verify(['groups'])).toBe(1);
    await migration.backfill(['groups'], true);
    expect(await groups.findOne({ name: 'Stray' })).toBeNull();
    expect(await groups.findOne({ name: 'Staff' })).toMatchObject({
      permissions: ['judge.edit_all_problem'],
    });
    expect(await migration.verify(['groups'])).toBe(0);
  });

  it('maps only the tables the jobs reference', async () => {
    await harness.mysql.query(
      `INSERT INTO ${harness.name}.judge_usersession (id, session_key, ip_address, user_agent, device_type, browser, os, created_at, last_activity, is_active, user_id)
       VALUES (901, 'k', '127.0.0.1', '', 'desktop', '', '', NOW(), NOW(), 1, 1)`,
    );
    await migration.backfill(['groups']);
    const entries = harness.db.collection('migrationIdMap');
    expect(await entries.countDocuments({ table: 'judge_usersession' })).toBe(
      0,
    );
    expect(
      await entries.countDocuments({ table: 'auth_group' }),
    ).toBeGreaterThan(0);
  });

  it('mints creation-time ids for timed tables, ordered by time not by legacy id', async () => {
    await harness.mysql.query(
      `INSERT INTO ${harness.name}.judge_comment (id, time, page, score, body, hidden, lft, rght, tree_id, level, author_id, parent_id, revisions)
       VALUES (901, '2021-05-01 00:00:00', 'p:x', 0, 'b', 0, 1, 2, 901, 0, 1, NULL, 0),
              (902, '2019-01-01 00:00:00', 'p:x', 0, 'b', 0, 1, 2, 902, 0, 1, NULL, 0)`,
    );
    const ids = harness.testingModule.get(IdMapRepository);
    await ids.build(['judge_comment']);
    await ids.load(['judge_comment']);
    const millis = (id: string) =>
      parseInt(id.replace(/-/g, '').slice(0, 12), 16);
    expect(millis(ids.get('judge_comment', 901))).toBe(Date.UTC(2021, 4, 1));
    expect(ids.get('judge_comment', 902) < ids.get('judge_comment', 901)).toBe(
      true,
    );
  });

  it('skips a profile whose user is gone instead of aborting the build', async () => {
    await harness.mysql.query(
      `SET FOREIGN_KEY_CHECKS=0; INSERT INTO ${harness.name}.judge_profile (id, user_id, timezone, display_rank, ace_theme, math_engine, site_theme) VALUES (990, 99990, 'UTC', 'user', 'auto', 'auto', 'auto'); SET FOREIGN_KEY_CHECKS=1;`,
    );
    const ids = harness.testingModule.get(IdMapRepository);
    await expect(
      ids.build(['auth_user', 'judge_profile']),
    ).resolves.toBeUndefined();
    await ids.load(['judge_profile']);
    expect(ids.find('judge_profile', 990)).toBeUndefined();
    expect(ids.find('judge_profile', 1)).toBe(ids.get('auth_user', 1));
  });
});
