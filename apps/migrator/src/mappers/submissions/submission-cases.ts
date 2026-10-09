import { clipBytes } from '@libs/common';
import {
  CASE_STATUSES,
  MAX_CASE_FEEDBACK_LENGTH,
  MAX_CASE_TEXT_LENGTH,
} from '@libs/database';
import type { CaseStatus, SubmissionCase } from '@libs/database';
import { MapCtx } from '../../mapper';

export interface CaseRow {
  id: number;
  submission_id: number;
  case: number;
  status: string;
  time: number | null;
  memory: number | null;
  points: number | null;
  total: number | null;
  batch: number | null;
  feedback: string | null;
  extended_feedback: string | null;
  output: string | null;
}

export const MAX_CASES = 10_000;
/** Ordered by the parent key only, so MariaDB walks the `submission_id` index; cases are sorted per submission here. */
export const TESTCASES_SQL =
  'SELECT id, submission_id, `case`, status, time, memory, points, total, batch, feedback, extended_feedback, output FROM judge_submissiontestcase ORDER BY submission_id';

const isCaseStatus = (status: string): status is CaseStatus =>
  (CASE_STATUSES as readonly string[]).includes(status);

const caseOf = (row: CaseRow, status: CaseStatus): SubmissionCase => ({
  position: Number(row.case),
  status,
  time: Number(row.time ?? 0),
  memory: Number(row.memory ?? 0),
  points: Number(row.points ?? 0),
  total: Number(row.total ?? 0),
  batch: row.batch ?? null,
  feedback: clipBytes(row.feedback ?? '', MAX_CASE_FEEDBACK_LENGTH),
  extendedFeedback: clipBytes(
    row.extended_feedback ?? '',
    MAX_CASE_TEXT_LENGTH,
  ),
  output: clipBytes(row.output ?? '', MAX_CASE_TEXT_LENGTH),
});

/** An unknown status (legacy `RJ` included: v2 has no internal-error case status) drops the case and is reported, so the report counts them. */
export function casesOf(
  rows: CaseRow[],
  ctx: MapCtx,
  where: string,
): SubmissionCase[] {
  const sorted = [...rows].sort(
    (left, right) => left.case - right.case || left.id - right.id,
  );
  if (sorted.length > MAX_CASES)
    ctx.report(
      `${where} ${sorted.length - MAX_CASES} case(s) over ${MAX_CASES} dropped`,
    );
  return sorted.slice(0, MAX_CASES).flatMap((row) => {
    if (isCaseStatus(row.status)) return [caseOf(row, row.status)];
    ctx.report(`${where} case status "${row.status}" dropped`);
    return [];
  });
}
