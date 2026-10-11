import type { CaseStatus } from '@libs/database';
import { TEST_SUMMARY_CAP, testSummaryOf } from './test-summary';
import type { CaseHead } from './test-summary';

const STATUS_OF: Record<string, CaseStatus> = { A: 'AC', W: 'WA', T: 'TLE' };
const head = (statuses: string, batches: (number | null)[] = []): CaseHead[] =>
  [...statuses].map((code, index) => ({
    status: STATUS_OF[code],
    batch: batches[index] ?? null,
  }));

describe('testSummaryOf', () => {
  it('lists every case in order with the problem case count, for the pending ones', () => {
    expect(testSummaryOf('case', head('AAW', [null, 1, 1]), 3, 5)).toEqual({
      unit: 'case',
      statuses: ['AC', 'AC', 'WA'],
      batches: [null, 1, 1],
      more: 0,
      total: 5,
    });
  });

  it(`keeps the first ${TEST_SUMMARY_CAP} cases and counts the judged rest`, () => {
    const summary = testSummaryOf('case', head('A'.repeat(120)), 120, 150);
    expect(summary.statuses).toHaveLength(TEST_SUMMARY_CAP);
    expect(summary.batches).toHaveLength(TEST_SUMMARY_CAP);
    expect(summary.more).toBe(20);
  });

  it('summarises batches by their first non-accepted case, ignoring cases outside a batch', () => {
    expect(
      testSummaryOf('batch', head('WAATAA', [null, 1, 1, 2, 2, 3]), 6, 9),
    ).toEqual({
      unit: 'batch',
      statuses: ['AC', 'TLE', 'AC'],
      batches: [1, 2, 3],
      more: 0,
      total: null,
    });
  });
});
