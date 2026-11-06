import { MigrationRecord } from '@libs/database';
import { MIGRATIONS } from './migration';
import type { Migration } from './migration';
import { MigrationRunner } from './migration-runner.service';
import { setupMigrationsTest } from '../../test/migrations-setup';
import type { MigrationsTest } from '../../test/migrations-setup';

const recordedIds = async (test: MigrationsTest) =>
  (
    await test
      .model<MigrationRecord>(MigrationRecord.name)
      .find()
      .sort({ _id: 1 })
      .lean()
  ).map((record) => record._id);

describe('MigrationRunner', () => {
  describe('with the shipped migrations', () => {
    let test: MigrationsTest;
    beforeAll(async () => {
      test = await setupMigrationsTest();
    });
    afterAll(() => test.teardown());

    it('runs each one once, records each id once, and runs none again', async () => {
      const ids = test.module
        .get<Migration[]>(MIGRATIONS)
        .map((migration) => migration.id);
      expect(new Set(ids).size).toBe(ids.length);
      const runner = test.module.get(MigrationRunner);

      expect(await runner.runPending()).toEqual(ids);
      expect(await runner.runPending()).toEqual([]);
      expect(await recordedIds(test)).toEqual([...ids].sort());
    });
  });

  describe('when a migration fails', () => {
    const ran: string[] = [];
    let failure: Error | null = Object.assign(
      new Error('E11000 dup key: { username: "secret" }'),
      { code: 11000, codeName: 'DuplicateKey' },
    );
    const migration = (id: string): Migration => ({
      id,
      run: () => {
        if (id === 'b' && failure) return Promise.reject(failure);
        ran.push(id);
        return Promise.resolve(1);
      },
    });
    let test: MigrationsTest;
    beforeAll(async () => {
      test = await setupMigrationsTest({
        provide: MIGRATIONS,
        useValue: ['a', 'b', 'c'].map(migration),
      });
    });
    afterAll(() => test.teardown());

    it('stops there, keeps what ran before it, names only the Mongo error code, and resumes at it on the next run', async () => {
      const runner = test.module.get(MigrationRunner);

      await expect(runner.runPending()).rejects.toThrow(
        /^b failed: DuplicateKey \(code 11000\)$/,
      );
      expect(ran).toEqual(['a']);
      expect(await recordedIds(test)).toEqual(['a']);

      failure = new Error('ENOSPC: no space left on device');
      await expect(runner.runPending()).rejects.toThrow(
        'b failed: ENOSPC: no space left on device',
      );
      failure = null;
      expect(await runner.runPending()).toEqual(['b', 'c']);
      expect(ran).toEqual(['a', 'b', 'c']);
      expect(await recordedIds(test)).toEqual(['a', 'b', 'c']);
    });
  });
});
