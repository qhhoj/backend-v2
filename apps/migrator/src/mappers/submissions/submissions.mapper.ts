import { Injectable } from '@nestjs/common';
import {
  SUBMISSION_PRIORITY,
  SUBMISSION_RESULTS,
  SUBMISSION_STATUSES,
} from '@libs/database';
import type { SubmissionResult, SubmissionStatus } from '@libs/database';
import { ChildQuery, MapCtx, MappedDocument, Mapper } from '../../mapper';
import { importedSubmission } from '../imported-rows';
import { CaseRow, casesOf, TESTCASES_SQL } from './submission-cases';

type Row = {
  id: number;
  date: Date;
  time: number | null;
  memory: number | null;
  points: number | null;
  status: string;
  result: string | null;
  error: string | null;
  current_testcase: number;
  batch: number;
  case_points: number;
  case_total: number;
  is_pretested: number;
  language_id: number;
  problem_id: number;
  user_id: number;
  contest_object_id: number | null;
  judged_date: Date | null;
  locked_after: Date | null;
  rejudged_date: Date | null;
};

@Injectable()
export class SubmissionsMapper implements Mapper<Row, CaseRow> {
  name = 'submissions';
  collection = 'submissions';
  refTables = [
    'judge_submission',
    'judge_profile',
    'judge_problem',
    'judge_language',
    'judge_contest',
  ];
  /** STRAIGHT_JOIN: without it MariaDB drives from `judge_problemgroup` with a temporary table and a filesort (Task 0 EXPLAIN). */
  sql = `SELECT STRAIGHT_JOIN s.id, s.date, s.time, s.memory, s.points, s.status, s.result, s.error,
    s.current_testcase, s.batch, s.case_points, s.case_total, s.is_pretested, s.language_id, s.problem_id,
    s.user_id, s.contest_object_id, s.judged_date, s.locked_after, s.rejudged_date
    FROM judge_submission s ${importedSubmission('s')} ORDER BY s.id`;
  children: ChildQuery<CaseRow> = { sql: TESTCASES_SQL, key: 'submission_id' };

  map(row: Row, ctx: MapCtx, cases: CaseRow[]): MappedDocument {
    const where = `judge_submission:${row.id}`;
    return {
      _id: ctx.ref('judge_submission', row.id)!,
      user: ctx.ref('judge_profile', row.user_id)!,
      problem: ctx.ref('judge_problem', row.problem_id)!,
      language: ctx.ref('judge_language', row.language_id)!,
      contest: ctx.refOrNull('judge_contest', row.contest_object_id),
      date: ctx.date(row.date),
      status: this.statusOf(row.status, where, ctx),
      result: this.resultOf(row.result, where, ctx),
      ...this.grading(row, ctx),
      // Judges are not migrated (they register fresh), so there is no name to keep.
      judgedOn: null,
      priority: SUBMISSION_PRIORITY.normal,
      requeueCount: 0,
      cases: casesOf(cases, ctx, where),
      createdAt: ctx.date(row.date),
      updatedAt: ctx.date(row.date),
    };
  }

  private grading(row: Row, ctx: MapCtx) {
    return {
      time: row.time,
      memory: row.memory,
      points: row.points,
      casePoints: Number(row.case_points ?? 0),
      caseTotal: Number(row.case_total ?? 0),
      error: row.error,
      currentTestcase: Number(row.current_testcase ?? 0),
      batch: ctx.bool(row.batch),
      isPretested: ctx.bool(row.is_pretested),
      judgedDate: ctx.date(row.judged_date),
      rejudgedDate: ctx.date(row.rejudged_date),
      lockedAfter: ctx.date(row.locked_after),
    };
  }

  /** In flight at cutover goes back to the queue; the bridge rebuilds its queue from Mongo. */
  private statusOf(
    status: string,
    where: string,
    ctx: MapCtx,
  ): SubmissionStatus {
    if (status === 'P' || status === 'G') return 'QU';
    if ((SUBMISSION_STATUSES as readonly string[]).includes(status))
      return status as SubmissionStatus;
    ctx.report(`${where} status "${status}" → IE`);
    return 'IE';
  }

  private resultOf(
    result: string | null,
    where: string,
    ctx: MapCtx,
  ): SubmissionResult | null {
    if (!result) return null;
    if ((SUBMISSION_RESULTS as readonly string[]).includes(result))
      return result as SubmissionResult;
    ctx.report(`${where} result "${result}" → null`);
    return null;
  }
}
