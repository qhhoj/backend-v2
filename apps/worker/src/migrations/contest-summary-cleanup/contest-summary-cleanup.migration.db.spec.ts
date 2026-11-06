import type { Model } from 'mongoose';
import { Contest } from '@libs/database';
import { setupMigrationsTest } from '../../../test/migrations-setup';
import type { MigrationsTest } from '../../../test/migrations-setup';
import { ContestSummaryCleanupMigration } from './contest-summary-cleanup.migration';

/** The text the old site's organiser typed into the summary box (CRLF, as the legacy admin saved it). */
const LEGACY_SUMMARY = '{\r\n    "cumtime": true\r\n}';

describe('contest summary cleanup migration', () => {
  let test: MigrationsTest;
  let contests: Model<Contest>;
  let cleanup: ContestSummaryCleanupMigration;
  let contestCount = 0;

  beforeAll(async () => {
    test = await setupMigrationsTest();
    contests = test.model(Contest.name);
    cleanup = test.module.get(ContestSummaryCleanupMigration);
  });
  afterAll(() => test.teardown());

  const contest = async (fields: Partial<Contest>): Promise<string> => {
    const created = await contests.create({
      key: `summary_${(contestCount += 1)}`,
      name: 'SQRT Cup',
      startTime: new Date('2025-07-05T13:00:00Z'),
      endTime: new Date('2025-07-05T15:30:00Z'),
      ...fields,
    });
    return created.key;
  };
  const stored = async (key: string) =>
    (await contests.findOne({ key }).lean())!;

  it('empties format-config summaries, fills only missing config keys, leaves prose alone, and is idempotent', async () => {
    const configSet = await contest({
      formatName: 'ioi16',
      formatConfig: { cumtime: false },
      summary: LEGACY_SUMMARY,
    });
    const configMissing = await contest({
      formatName: 'icpc',
      formatConfig: {},
      summary: '{"penalty": 10}',
    });
    const formatWithoutOptions = await contest({
      formatName: 'default',
      formatConfig: {},
      summary: '{"cumtime": true}',
    });
    const prose = await contest({ summary: 'Vòng loại thứ nhất của SQRT Cup' });
    const braceProse = await contest({ summary: '{Div. 2} Vòng loại' });
    const otherJson = await contest({ summary: '{"note": "xem đề"}' });

    expect(await cleanup.run()).toBe(3);

    expect(await stored(configSet)).toMatchObject({
      summary: '',
      formatConfig: { cumtime: false },
    });
    expect(await stored(configMissing)).toMatchObject({
      summary: '',
      formatConfig: { penalty: 10 },
    });
    expect(await stored(formatWithoutOptions)).toMatchObject({
      summary: '',
      formatConfig: {},
    });
    expect((await stored(prose)).summary).toBe(
      'Vòng loại thứ nhất của SQRT Cup',
    );
    expect((await stored(braceProse)).summary).toBe('{Div. 2} Vòng loại');
    expect((await stored(otherJson)).summary).toBe('{"note": "xem đề"}');

    const contestsBefore = await contests.find().sort({ _id: 1 }).lean();
    expect(await cleanup.run()).toBe(0);
    expect(await contests.find().sort({ _id: 1 }).lean()).toEqual(
      contestsBefore,
    );
  });
});
