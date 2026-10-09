import { newId, toUuid, uuidStr } from '@libs/database';
import { RowDataPacket } from 'mysql2/promise';
import { IdMapRepository } from '../src/id-map.repository';
import { MappedDocument } from '../src/mapper';
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
    await migration.backfill(['groups']);
    const first = await snapshot();
    expect(first).toHaveLength(Number(rows[0].total));
    expect(new Set(first.map((entry) => entry.split(':')[1])).size).toBe(
      first.length,
    );
    await migration.backfill(['groups']);
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
});
