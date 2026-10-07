import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
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

  /** The contest's rows through a cursor (`{contest, problem}` index). */
  submissionChunks(contestId: string): AsyncGenerator<ContestSubmissionRow[]> {
    return inChunks(
      this.contestSubmissions
        .find({ contest: contestId }, { problem: 1, points: 1 })
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
