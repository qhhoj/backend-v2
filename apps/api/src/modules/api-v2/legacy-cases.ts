import type { SubmissionCase } from '@libs/database';
import type { CaseVisibility } from '../submissions/core/submission-access';

export interface LegacyCase {
  type: 'case';
  case_id: number;
  status: string;
  time: number;
  memory: number;
  points: number;
  total: number;
}

export interface LegacyBatch {
  type: 'batch';
  batch_id: number;
  cases: LegacyCase[];
  /** Smallest points and largest total of the batch (`make_batch`). */
  points: number;
  total: number;
}

export type LegacyCaseEntry = LegacyCase | LegacyBatch;

/** Legacy `group_test_cases` + `make_batch`: consecutive cases of one batch become one batch entry, cases outside batches stay single. Unlike legacy, the problem's case visibility applies like on `/api/internal`: `batches` keeps only batch totals, `none` nothing. */
export function legacyCases(
  cases: readonly SubmissionCase[],
  shown: CaseVisibility['cases'],
): LegacyCaseEntry[] {
  if (shown === 'none') return [];
  const entries: LegacyCaseEntry[] = [];
  let current = null as LegacyBatch | null;
  for (const testCase of cases) {
    const row: LegacyCase = {
      type: 'case',
      case_id: testCase.position,
      status: testCase.status,
      time: testCase.time,
      memory: testCase.memory,
      points: testCase.points,
      total: testCase.total,
    };
    if (testCase.batch === null) {
      current = null;
      if (shown === 'all') entries.push(row);
      continue;
    }
    if (current?.batch_id !== testCase.batch) {
      current = {
        type: 'batch',
        batch_id: testCase.batch,
        cases: [],
        points: testCase.points,
        total: testCase.total,
      };
      entries.push(current);
    }
    current.points = Math.min(current.points, testCase.points);
    current.total = Math.max(current.total, testCase.total);
    if (shown === 'all') current.cases.push(row);
  }
  return entries;
}
