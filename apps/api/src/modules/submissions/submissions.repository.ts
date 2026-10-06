import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type {
  Connection,
  FilterQuery,
  HydratedDocument,
  Model,
} from 'mongoose';
import {
  isUuid,
  newId,
  Submission,
  SubmissionSource,
  UNFINISHED_STATUSES,
} from '@libs/database';

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
}
