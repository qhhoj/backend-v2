import type { SubmissionCase } from '@libs/database';
import { legacyCases } from './legacy-cases';

const testCase = (
  position: number,
  batch: number | null,
  extra: Partial<SubmissionCase> = {},
): SubmissionCase => ({
  position,
  status: 'AC',
  time: position / 10,
  memory: position * 100,
  points: 1,
  total: 1,
  batch,
  feedback: 'secret feedback',
  extendedFeedback: 'secret',
  output: 'secret output',
  ...extra,
});
const CASES = [
  testCase(1, null),
  testCase(2, 1, { points: 2, total: 2 }),
  testCase(3, 1, { status: 'WA', points: 0, total: 3 }),
  testCase(4, null, { status: 'TLE', points: 0 }),
  testCase(5, 2),
];

describe('legacyCases (group_test_cases + make_batch)', () => {
  it('keeps plain cases single and folds each run of a batch into one entry', () => {
    const entries = legacyCases(CASES, 'all');
    expect(entries.map((entry) => entry.type)).toEqual([
      'case',
      'batch',
      'case',
      'batch',
    ]);
    expect(entries[0]).toEqual({
      type: 'case',
      case_id: 1,
      status: 'AC',
      time: 0.1,
      memory: 100,
      points: 1,
      total: 1,
    });
    expect(entries[1]).toMatchObject({
      type: 'batch',
      batch_id: 1,
      points: 0,
      total: 3,
    });
    expect(
      entries[1].type === 'batch' &&
        entries[1].cases.map((entry) => entry.case_id),
    ).toEqual([2, 3]);
  });

  it('never carries feedback or output', () =>
    expect(JSON.stringify(legacyCases(CASES, 'all'))).not.toContain('secret'));

  it('shows batch totals without their cases, or nothing, when the problem hides case results', () => {
    expect(legacyCases(CASES, 'batches')).toEqual([
      { type: 'batch', batch_id: 1, cases: [], points: 0, total: 3 },
      { type: 'batch', batch_id: 2, cases: [], points: 1, total: 1 },
    ]);
    expect(legacyCases(CASES, 'none')).toEqual([]);
  });
});
