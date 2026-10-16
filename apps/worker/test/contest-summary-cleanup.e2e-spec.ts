import type { Contest } from '@libs/database';
import { ContestSummaryCleanupService } from '../src/jobs/contest-summary-cleanup/contest-summary-cleanup.service';
import { setupWorkerTest } from './setup';
import type { WorkerTest } from './setup';

/** The text the old site's organiser typed into the summary box (CRLF, as the legacy admin saved it). */
const LEGACY_SUMMARY = '{\r\n    "cumtime": true\r\n}';

describe('Contest summary cleanup', () => {
  let worker: WorkerTest;
  let cleanup: ContestSummaryCleanupService;
  let contestCount = 0;

  beforeAll(async () => {
    worker = await setupWorkerTest();
    cleanup = worker.module.get(ContestSummaryCleanupService);
  });
  afterAll(() => worker.teardown());

  const contest = async (fields: Partial<Contest>): Promise<string> => {
    const created = await worker.contests.create({
      key: `summary_${(contestCount += 1)}`,
      name: 'SQRT Cup',
      startTime: new Date('2025-07-05T13:00:00Z'),
      endTime: new Date('2025-07-05T15:30:00Z'),
      ...fields,
    });
    return created.key;
  };
  const stored = async (key: string) =>
    (await worker.contests.findOne({ key }).lean())!;

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

    expect(await cleanup.run()).toEqual({
      found: 5,
      cleared: 3,
      configFilled: 1,
      clearedKeys: [configSet, configMissing, formatWithoutOptions],
    });

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

    const contestsBefore = await worker.contests.find().sort({ _id: 1 }).lean();
    expect(await cleanup.run()).toEqual({
      found: 2,
      cleared: 0,
      configFilled: 0,
      clearedKeys: [],
    });
    expect(await worker.contests.find().sort({ _id: 1 }).lean()).toEqual(
      contestsBefore,
    );
  });
});
