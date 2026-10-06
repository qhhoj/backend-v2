import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Submission } from '@libs/database';

/** Writes per `bulkWrite`. */
export const RESCORE_CHUNK = 1000;

export interface RescoredRow {
  id: string;
  /** The case totals the new points were computed from. */
  casePoints: number;
  caseTotal: number;
  points: number;
}

@Injectable()
export class ProblemRescoreRepository {
  constructor(
    @InjectModel(Submission.name)
    private readonly submissions: Model<Submission>,
  ) {}

  /** Graded rows of the problem, oldest first, through a cursor (`{ problem, status, _id }` index): a problem's history is never held in memory. Compile errors, internal errors and aborts keep their points; rejected submissions stay at 0 (legacy `reject`). */
  gradedRows(problemId: string) {
    return this.submissions
      .find(
        { problem: problemId, status: 'D', result: { $ne: 'RJ' } },
        { user: 1, points: 1, casePoints: 1, caseTotal: 1 },
      )
      .sort({ _id: 1 })
      .lean()
      .cursor();
  }

  /** Each write still requires the case totals it was computed from, so a rejudge that finished meanwhile keeps its own points. */
  async setPoints(rows: RescoredRow[]): Promise<number> {
    if (!rows.length) return 0;
    const { modifiedCount } = await this.submissions.bulkWrite(
      rows.map((row) => ({
        updateOne: {
          filter: {
            _id: row.id,
            status: 'D',
            casePoints: row.casePoints,
            caseTotal: row.caseTotal,
          },
          update: { $set: { points: row.points } },
        },
      })),
      { ordered: false },
    );
    return modifiedCount;
  }
}
