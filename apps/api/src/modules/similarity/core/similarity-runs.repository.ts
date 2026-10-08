import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import {
  Contest,
  isUuid,
  Problem,
  SimilarityRun,
  uuidStr,
} from '@libs/database';
import type {
  SimilarityError,
  SimilarityLimits,
  SimilarityScope,
} from '@libs/database';

export interface NewSimilarityRun {
  scope: SimilarityScope;
  scopeKey: string;
  problem: string | null;
  contest: string | null;
  requestedBy: string;
  limits: SimilarityLimits;
}

const DUPLICATE_KEY = 11000;
const ABANDONED: SimilarityError = 'abandoned';

@Injectable()
export class SimilarityRunsRepository {
  constructor(
    @InjectModel(SimilarityRun.name)
    private readonly runs: Model<SimilarityRun>,
    @InjectModel(Problem.name) private readonly problems: Model<Problem>,
    @InjectModel(Contest.name) private readonly contests: Model<Contest>,
  ) {}

  findProblemByCode(code: string): Promise<Problem | null> {
    return this.problems.findOne({ code }).exec();
  }

  /** Null for a malformed id, like an unknown one. */
  findProblemById(id: string): Promise<Problem | null> {
    return isUuid(id)
      ? this.problems.findById(id).exec()
      : Promise.resolve(null);
  }

  /** The given problems that still exist. */
  findProblemsByIds(ids: string[]): Promise<Problem[]> {
    if (!ids.length) return Promise.resolve([]);
    return this.problems.find({ _id: { $in: ids } }).exec();
  }

  findContestByKey(key: string): Promise<Contest | null> {
    return this.contests.findOne({ key }).exec();
  }

  /** Null for a malformed id, like an unknown one. */
  findContestById(id: string): Promise<Contest | null> {
    return isUuid(id)
      ? this.contests.findById(id).exec()
      : Promise.resolve(null);
  }

  /** Null when the scope already has an active run (the partial unique index on `scopeKey`). */
  async createRun(fields: NewSimilarityRun): Promise<SimilarityRun | null> {
    try {
      return await this.runs.create(fields);
    } catch (error) {
      if ((error as { code?: number }).code === DUPLICATE_KEY) return null;
      throw error;
    }
  }

  /** Frees the scope of an active run created before `before`: its job is gone (lost job, crash) or stuck behind a backlog, where the worker's claim then finds nothing to do. */
  async releaseStale(scopeKey: string, before: Date): Promise<void> {
    await this.runs
      .updateMany(
        { scopeKey, active: true, createdAt: { $lt: before } },
        {
          $set: {
            status: 'failed',
            active: false,
            error: ABANDONED,
            finishedAt: new Date(),
          },
        },
      )
      .exec();
  }

  async deleteRun(id: string): Promise<void> {
    await this.runs.deleteOne({ _id: id }).exec();
  }

  /** Ends an active run as failed, freeing its scope. */
  async failRun(id: string, error: SimilarityError): Promise<void> {
    await this.runs
      .updateOne(
        { _id: id, active: true },
        {
          $set: {
            status: 'failed',
            active: false,
            error,
            finishedAt: new Date(),
          },
        },
      )
      .exec();
  }

  /** Newest first (ids are time-ordered uuid v7). */
  recentRuns(scopeKey: string, limit: number): Promise<SimilarityRun[]> {
    return this.runs.find({ scopeKey }).sort({ _id: -1 }).limit(limit).exec();
  }

  /** Null for a malformed id, like an unknown one. */
  findRun(id: string): Promise<SimilarityRun | null> {
    return isUuid(id) ? this.runs.findById(id).exec() : Promise.resolve(null);
  }

  /** Problem id to code, for the given ids that still exist. */
  async problemCodes(ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await this.problems
      .find({ _id: { $in: ids } }, { code: 1 })
      .lean()
      .exec();
    return new Map(rows.map((row) => [uuidStr(row._id), row.code]));
  }
}
