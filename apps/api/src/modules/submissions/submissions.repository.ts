import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type {
  Connection,
  FilterQuery,
  HydratedDocument,
  Model,
} from 'mongoose';
import {
  IN_FLIGHT_STATUSES,
  isUuid,
  newId,
  Submission,
  SubmissionSource,
  UNFINISHED_STATUSES,
  uuidStr,
} from '@libs/database';
import { JUDGE_COMMAND_BATCH } from '@libs/judging';

export type SubmissionDocument = HydratedDocument<Submission>;

@Injectable()
export class SubmissionsRepository {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Submission.name)
    private readonly submissions: Model<Submission>,
    @InjectModel(SubmissionSource.name)
    private readonly sources: Model<SubmissionSource>,
  ) {}

  /** The row and its source in one transaction, so the bridge never claims a submission without a source. */
  async create(
    fields: Pick<Submission, 'user' | 'problem' | 'language'>,
    source: string,
  ): Promise<string> {
    const id = newId();
    await this.connection.transaction(async (session) => {
      // `create` with a session takes an array.
      await this.sources.create([{ _id: id, source }], { session });
      await this.submissions.create([{ _id: id, ...fields }], { session });
    });
    return id;
  }

  /** Legacy: rejudged submissions do not count against the user. */
  countUnfinished(userId: string): Promise<number> {
    return this.submissions
      .countDocuments({
        user: userId,
        status: { $in: [...UNFINISHED_STATUSES] },
        rejudgedDate: null,
      })
      .exec();
  }

  /** Null for malformed ids too. `cases` (up to 10000 rows) only when asked for. */
  findById(id: string, withCases = false): Promise<SubmissionDocument | null> {
    if (!isUuid(id)) return Promise.resolve(null);
    const query = this.submissions.findById(id);
    return (withCases ? query.select('+cases') : query).exec();
  }

  async findSource(id: string): Promise<string | null> {
    return (await this.sources.findById(id).lean())?.source ?? null;
  }

  /** Newest first (UUIDv7 ids grow with time); list rows never carry the error log. */
  async list(
    filter: FilterQuery<Submission>,
    page: number,
    pageSize: number,
  ): Promise<{ items: SubmissionDocument[]; total: number }> {
    const [items, total] = await Promise.all([
      this.submissions
        .find(filter, { error: 0 })
        .sort({ _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .exec(),
      this.submissions.countDocuments(filter).exec(),
    ]);
    return { items, total };
  }

  /** Legacy SOLVED visibility: an AC worth the problem's full points. */
  async hasSolved(
    userId: string,
    problemId: string,
    points: number,
  ): Promise<boolean> {
    return (
      (await this.submissions.exists({
        user: userId,
        problem: problemId,
        result: 'AC',
        points: { $gte: points },
      })) !== null
    );
  }

  /** QU → AB in one step; false when the bridge claimed it meanwhile (the abort command then terminates it). */
  async abortQueued(id: string): Promise<boolean> {
    const { modifiedCount } = await this.submissions
      .updateOne(
        { _id: id, status: 'QU' },
        { $set: { status: 'AB', result: 'AB', points: 0 } },
      )
      .exec();
    return modifiedCount === 1;
  }

  /** Legacy `judge_submission`: back to QU at `priority` with every result cleared, except while a judge holds it (P/G). The requeue allowance is restored: a rejudge is a fresh attempt. Returns how many were reset. */
  async resetForJudging(ids: string[], priority: number): Promise<number> {
    const { modifiedCount } = await this.submissions
      .updateMany(
        { _id: { $in: ids }, status: { $nin: [...IN_FLIGHT_STATUSES] } },
        {
          $set: {
            status: 'QU',
            result: null,
            time: null,
            memory: null,
            points: null,
            casePoints: 0,
            caseTotal: 0,
            error: null,
            cases: [],
            currentTestcase: 0,
            batch: false,
            isPretested: false,
            judgedOn: null,
            judgedDate: null,
            rejudgedDate: new Date(),
            priority,
            requeueCount: 0,
          },
        },
      )
      .exec();
    return modifiedCount;
  }

  /** Legacy `Submission.reject`, once judging is over: result RJ, no points, cases cleared. */
  async reject(id: string): Promise<boolean> {
    const { matchedCount } = await this.submissions
      .updateOne(
        { _id: id, status: { $nin: [...UNFINISHED_STATUSES] } },
        { $set: { result: 'RJ', points: 0, casePoints: 0, cases: [] } },
      )
      .exec();
    return matchedCount === 1;
  }

  countMatching(filter: FilterQuery<Submission>): Promise<number> {
    return this.submissions.countDocuments(filter).exec();
  }

  /** Matching ids in order, `JUDGE_COMMAND_BATCH` at a time, so a problem's whole history is never held in memory. */
  async *idChunks(filter: FilterQuery<Submission>): AsyncGenerator<string[]> {
    let chunk: string[] = [];
    const cursor = this.submissions
      .find(filter, { _id: 1 })
      .sort({ _id: 1 })
      .lean()
      .cursor();
    for await (const row of cursor) {
      chunk.push(uuidStr(row._id));
      if (chunk.length === JUDGE_COMMAND_BATCH) {
        yield chunk;
        chunk = [];
      }
    }
    if (chunk.length) yield chunk;
  }
}
