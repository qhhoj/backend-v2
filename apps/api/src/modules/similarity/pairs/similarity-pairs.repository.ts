import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { FilterQuery, Model } from 'mongoose';
import {
  isUuid,
  SimilarityPair,
  Submission,
  SubmissionSource,
  User,
  uuidStr,
} from '@libs/database';

export interface PairFilter {
  /** Any of these problems. */
  problemIds?: string[];
  language?: string;
  minSimilarity?: number;
}

export interface SubmissionFacts {
  date: Date;
  result: string | null;
  points: number | null;
}

@Injectable()
export class SimilarityPairsRepository {
  constructor(
    @InjectModel(SimilarityPair.name)
    private readonly pairs: Model<SimilarityPair>,
    @InjectModel(Submission.name)
    private readonly submissions: Model<Submission>,
    @InjectModel(SubmissionSource.name)
    private readonly sources: Model<SubmissionSource>,
    @InjectModel(User.name) private readonly users: Model<User>,
  ) {}

  /**
   * Best first. With no filter, or a problem and a language, an index serves
   * the sort and the count (`{run, similarity, _id}`, `{run, problem, language,
   * similarity, _id}`). A problem-only or language-only filter reads through
   * `{run, similarity, _id}` and filters after: bounded by the run's
   * `maxPairs`, not by the page size.
   */
  async pairsPage(
    runId: string,
    filter: PairFilter,
    page: number,
    pageSize: number,
  ): Promise<{ items: SimilarityPair[]; total: number }> {
    const query: FilterQuery<SimilarityPair> = { run: runId };
    if (filter.problemIds) query.problem = { $in: filter.problemIds };
    if (filter.language) query.language = filter.language;
    if (filter.minSimilarity !== undefined)
      query.similarity = { $gte: filter.minSimilarity };
    const [items, total] = await Promise.all([
      this.pairs
        .find(query)
        .sort({ similarity: -1, _id: 1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .exec(),
      this.pairs.countDocuments(query).exec(),
    ]);
    return { items, total };
  }

  /** The problems the run has pairs on. */
  async problemIdsOf(runId: string): Promise<string[]> {
    const problemIds = await this.pairs
      .distinct('problem', { run: runId })
      .exec();
    return problemIds.map((problemId) => uuidStr(problemId));
  }

  /** Null for a malformed id, like an unknown one. */
  findPair(id: string): Promise<SimilarityPair | null> {
    return isUuid(id) ? this.pairs.findById(id).exec() : Promise.resolve(null);
  }

  /** User id to username, for the given ids that still exist. */
  async usernames(ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await this.users
      .find({ _id: { $in: ids } }, { username: 1 })
      .lean()
      .exec();
    return new Map(rows.map((row) => [uuidStr(row._id), row.username]));
  }

  /** Submission id to its judging facts, for the given ids that still exist. */
  async submissionFacts(ids: string[]): Promise<Map<string, SubmissionFacts>> {
    const rows = await this.submissions
      .find({ _id: { $in: ids } }, { date: 1, result: 1, points: 1 })
      .lean()
      .exec();
    return new Map(
      rows.map((row) => [
        uuidStr(row._id),
        { date: row.date, result: row.result, points: row.points },
      ]),
    );
  }

  /** Submission id to source, for the given ids that still have one. */
  async sourcesOf(ids: string[]): Promise<Map<string, string>> {
    const rows = await this.sources
      .find({ _id: { $in: ids } }, { source: 1 })
      .lean()
      .exec();
    return new Map(rows.map((row) => [uuidStr(row._id), row.source]));
  }
}
