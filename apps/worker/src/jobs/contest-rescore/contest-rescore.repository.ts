import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type { ContestRescoreScope } from '@libs/contests';
import {
  ContestParticipation,
  ContestSubmission,
  Rating,
  uuidStr,
} from '@libs/database';

/** Rows read and written per round trip. */
export const RESCORE_CHUNK = 1000;
export interface ContestSubmissionRow {
  _id: unknown;
  problem: unknown;
  points: number;
}

/** A cursor's rows `RESCORE_CHUNK` at a time: a contest's history is never held in memory. */
async function* inChunks<Row>(
  cursor: AsyncIterable<Row>,
): AsyncGenerator<Row[]> {
  let chunk: Row[] = [];
  for await (const row of cursor) {
    chunk.push(row);
    if (chunk.length === RESCORE_CHUNK) {
      yield chunk;
      chunk = [];
    }
  }
  if (chunk.length) yield chunk;
}

@Injectable()
export class ContestRescoreRepository {
  constructor(
    @InjectModel(ContestSubmission.name)
    private readonly contestSubmissions: Model<ContestSubmission>,
    @InjectModel(ContestParticipation.name)
    private readonly participations: Model<ContestParticipation>,
    @InjectModel(Rating.name) private readonly ratings: Model<Rating>,
  ) {}

  /** Through the `{contest, user}` index. */
  async hasRatings(contestId: string): Promise<boolean> {
    return (await this.ratings.exists({ contest: contestId })) !== null;
  }

  /** The contest's rows, or the scope's, through a cursor (`{contest, problem}` or `{participation, problem}` index). */
  submissionChunks(
    contestId: string,
    scope: ContestRescoreScope = {},
  ): AsyncGenerator<ContestSubmissionRow[]> {
    return inChunks(
      this.contestSubmissions
        .find(
          {
            contest: contestId,
            ...(scope.problemId ? { problem: scope.problemId } : {}),
            ...(scope.participationId
              ? { participation: scope.participationId }
              : {}),
          },
          { problem: 1, points: 1 },
        )
        .lean<ContestSubmissionRow>()
        .cursor(),
    );
  }

  /** The contest's participation ids through a cursor (`{contest, virtual}` index). */
  participationChunks(contestId: string): AsyncGenerator<string[]> {
    return inChunks(
      this.participations
        .find({ contest: contestId }, { _id: 1 })
        .lean<{ _id: unknown }>()
        .cursor()
        .map((row) => uuidStr(row._id)),
    );
  }

  /** The participations that sent the problem a submission, through a cursor (`{contest, problem}` index), each id once. */
  async *participationsOfProblem(
    contestId: string,
    problemId: string,
  ): AsyncGenerator<string[]> {
    const seen = new Set<string>();
    const rows = this.contestSubmissions
      .find({ contest: contestId, problem: problemId }, { participation: 1 })
      .lean<{ participation: unknown }>()
      .cursor();
    for await (const chunk of inChunks(rows)) {
      const fresh = chunk
        .map((row) => uuidStr(row.participation))
        .filter((id) => !seen.has(id) && seen.add(id));
      if (fresh.length) yield fresh;
    }
  }

  /** Each write requires the points the row was read with, so a regrade that landed meanwhile keeps its own (its graded job recomputes the participation). */
  async setPoints(
    changes: Array<{ id: string; previous: number; points: number }>,
  ): Promise<number> {
    if (!changes.length) return 0;
    const { modifiedCount } = await this.contestSubmissions.bulkWrite(
      changes.map(({ id, previous, points }) => ({
        updateOne: {
          filter: { _id: id, points: previous },
          update: { $set: { points } },
        },
      })),
      { ordered: false },
    );
    return modifiedCount;
  }
}
