import { Injectable } from '@nestjs/common';
import { MapCtx, MappedDocument, Mapper } from '../../mapper';
import {
  importedParticipation,
  importedProblem,
  importedSubmission,
} from '../imported-rows';

type Row = {
  id: number;
  submission_id: number;
  participation_id: number;
  points: number;
  is_pretest: number;
  contest_id: number;
  problem_id: number;
};

@Injectable()
export class ContestSubmissionsMapper implements Mapper<Row> {
  name = 'contest-submissions';
  collection = 'contestSubmissions';
  refTables = [
    'judge_submission',
    'judge_contestparticipation',
    'judge_contest',
    'judge_problem',
  ];
  /** STRAIGHT_JOIN drives from judge_contestsubmission (PRIMARY, no temporary table or filesort; lane-S EXPLAIN). */
  sql = `SELECT STRAIGHT_JOIN cs.id, cs.submission_id, cs.participation_id, cs.points, cs.is_pretest,
    cp.contest_id, cp.problem_id
    FROM judge_contestsubmission cs
    JOIN judge_contestproblem cp ON cp.id = cs.problem_id
    JOIN judge_problem cpp ON cpp.id = cp.problem_id ${importedProblem('cpp')}
    JOIN judge_contestparticipation p ON p.id = cs.participation_id ${importedParticipation('p')}
    JOIN judge_submission s ON s.id = cs.submission_id ${importedSubmission('s')}
    ORDER BY cs.id`;

  map(row: Row, ctx: MapCtx): MappedDocument {
    return {
      _id: ctx.ref('judge_submission', row.submission_id)!,
      participation: ctx.ref(
        'judge_contestparticipation',
        row.participation_id,
      )!,
      contest: ctx.ref('judge_contest', row.contest_id)!,
      problem: ctx.ref('judge_problem', row.problem_id)!,
      points: Number(row.points ?? 0),
      isPretest: ctx.bool(row.is_pretest),
      createdAt: null,
      updatedAt: null,
    };
  }
}
