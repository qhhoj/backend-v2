import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Connection, FilterQuery, Model } from 'mongoose';
import { LIVE, SPECTATE } from '@libs/contests';
import {
  Contest,
  ContestParticipation,
  ContestSubmission,
  Language,
  SIMILARITY_RESULTS,
  SimilarityPair,
  SimilarityRun,
  Submission,
  SubmissionSource,
  newId,
  uuidStr,
} from '@libs/database';
import type {
  SimilarityError,
  SimilarityGroup,
  SimilarityUnsupported,
} from '@libs/database';
import type { LineRange } from './similarity-engine';

export interface SubmissionRow {
  id: string;
  user: string;
}
export interface StoredPair {
  problem: string;
  language: string;
  leftId: string;
  rightId: string;
  leftUser: string;
  rightUser: string;
  similarity: number;
  longest: number;
  overlap: number;
  fragments: LineRange[];
}
export interface RunOutcome {
  groups: SimilarityGroup[];
  unsupported: SimilarityUnsupported[];
  pairs: StoredPair[];
}
/** Which submissions to one problem a run compares. */
export interface ProblemScope {
  problemId: string;
  /** Contest scope: the contest's live and spectating submissions to this problem. Null: every submission to the problem. */
  contestSubmissionIds: string[] | null;
}

/** Thrown inside the `finish` transaction so it rolls back. */
class RunNoLongerRunningError extends Error {}

const toPairDocument = (runId: string, pair: StoredPair) => ({
  _id: newId(),
  run: runId,
  problem: pair.problem,
  language: pair.language,
  left: { submission: pair.leftId, user: pair.leftUser },
  right: { submission: pair.rightId, user: pair.rightUser },
  similarity: pair.similarity,
  longestFragment: pair.longest,
  totalOverlap: pair.overlap,
  fragments: pair.fragments,
});

@Injectable()
export class SimilarityRepository {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(SimilarityRun.name)
    private readonly runs: Model<SimilarityRun>,
    @InjectModel(SimilarityPair.name)
    private readonly pairs: Model<SimilarityPair>,
    @InjectModel(Submission.name)
    private readonly submissions: Model<Submission>,
    @InjectModel(SubmissionSource.name)
    private readonly sources: Model<SubmissionSource>,
    @InjectModel(Language.name) private readonly languageRows: Model<Language>,
    @InjectModel(Contest.name) private readonly contests: Model<Contest>,
    @InjectModel(ContestParticipation.name)
    private readonly participations: Model<ContestParticipation>,
    @InjectModel(ContestSubmission.name)
    private readonly contestSubmissions: Model<ContestSubmission>,
  ) {}

  /** Queued to running; null when the run is gone or not queued. */
  claim(runId: string): Promise<SimilarityRun | null> {
    return this.runs
      .findOneAndUpdate(
        { _id: runId, status: 'queued' },
        { $set: { status: 'running', startedAt: new Date() } },
        { new: true },
      )
      .lean<SimilarityRun>()
      .exec();
  }

  /** In contest order for a contest; the contest's submission ids are read here, once per run. */
  async problemScopes(run: SimilarityRun): Promise<ProblemScope[]> {
    if (run.scope === 'problem')
      return run.problem
        ? [{ problemId: uuidStr(run.problem), contestSubmissionIds: null }]
        : [];
    const contestId = uuidStr(run.contest);
    const [problemIds, idsByProblem] = await Promise.all([
      this.contestProblemIds(contestId),
      this.contestSubmissionIdsByProblem(contestId),
    ]);
    return problemIds.map((problemId) => ({
      problemId,
      contestSubmissionIds: idsByProblem.get(problemId) ?? [],
    }));
  }

  async languages(): Promise<Array<{ id: string; commonName: string }>> {
    const rows = await this.languageRows
      .find({}, { commonName: 1 })
      .lean()
      .exec();
    return rows.map((row) => ({
      id: uuidStr(row._id),
      commonName: row.commonName,
    }));
  }

  /** Eligible submissions in scope with one of these languages, before any cap. */
  countRows(scope: ProblemScope, languageIds: string[]): Promise<number> {
    return this.submissions
      .countDocuments(this.eligibleFilter(scope, languageIds))
      .exec();
  }

  /** The newest `limit` eligible rows, newest first (UUIDv7 ids are time ordered). */
  async submissionRows(
    scope: ProblemScope,
    languageIds: string[],
    limit: number,
  ): Promise<SubmissionRow[]> {
    const rows = await this.submissions
      .find(this.eligibleFilter(scope, languageIds), { user: 1 })
      .sort({ _id: -1 })
      .limit(limit)
      .lean()
      .exec();
    return rows.map((row) => ({
      id: uuidStr(row._id),
      user: uuidStr(row.user),
    }));
  }

  async sourcesOf(ids: string[]): Promise<Map<string, string>> {
    const rows = await this.sources
      .find({ _id: { $in: ids } })
      .lean()
      .exec();
    return new Map(rows.map((row) => [uuidStr(row._id), row.source]));
  }

  /**
   * Marks the run done, replaces the scope's earlier runs and stores the new pairs, all or nothing.
   * False, with nothing written, when the run is no longer running: the api released it as abandoned (and a newer run may already
   * own the scope), so its late results must not delete the earlier ones.
   */
  async finish(run: SimilarityRun, outcome: RunOutcome): Promise<boolean> {
    try {
      await this.connection.transaction(async (session) => {
        await this.markDone(run, outcome, session);
        await this.deleteEarlierRuns(run, session);
        await this.insertPairs(run, outcome.pairs, session);
      });
      return true;
    } catch (error) {
      if (error instanceof RunNoLongerRunningError) return false;
      throw error;
    }
  }

  /** Only a run that is still active: a finished run is never overwritten. */
  async markFailed(runId: string, reason: SimilarityError): Promise<void> {
    await this.runs
      .updateOne(
        { _id: runId, active: true },
        {
          $set: {
            status: 'failed',
            active: false,
            finishedAt: new Date(),
            error: reason,
          },
        },
        { runValidators: true },
      )
      .exec();
  }

  /** Language and result filters on top of the scope; only results whose source compiled and ran (`SIMILARITY_RESULTS`). */
  private eligibleFilter(
    scope: ProblemScope,
    languageIds: string[],
  ): FilterQuery<Submission> {
    const filter: FilterQuery<Submission> = {
      problem: scope.problemId,
      language: { $in: languageIds },
      result: { $in: SIMILARITY_RESULTS },
    };
    // One `$in` per problem: even a large contest problem's ids are far below the 16 MiB query limit.
    if (scope.contestSubmissionIds)
      filter._id = { $in: scope.contestSubmissionIds };
    return filter;
  }

  private async contestProblemIds(contestId: string): Promise<string[]> {
    const contest = await this.contests
      .findById(contestId, { problems: 1 })
      .lean()
      .exec();
    return [...(contest?.problems ?? [])]
      .sort((left, right) => left.order - right.order)
      .map((entry) => uuidStr(entry.problem));
  }

  /** Live and spectating participations only, as the MOSS flow before it: virtual participations run after the contest, when its solutions may already be public. */
  private async contestSubmissionIdsByProblem(
    contestId: string,
  ): Promise<Map<string, string[]>> {
    const participations = await this.participations
      .find(
        { contest: contestId, virtual: { $in: [LIVE, SPECTATE] } },
        { _id: 1 },
      )
      .lean()
      .exec();
    const rows = await this.contestSubmissions
      .find(
        {
          contest: contestId,
          participation: { $in: participations.map((row) => uuidStr(row._id)) },
        },
        { problem: 1 },
      )
      .lean()
      .exec();
    const idsByProblem = new Map<string, string[]>();
    for (const row of rows) {
      const problemId = uuidStr(row.problem);
      const ids = idsByProblem.get(problemId) ?? [];
      ids.push(uuidStr(row._id));
      idsByProblem.set(problemId, ids);
    }
    return idsByProblem;
  }

  /** First in the transaction, so a run released meanwhile aborts it before anything is deleted. */
  private async markDone(
    run: SimilarityRun,
    outcome: RunOutcome,
    session: ClientSession,
  ): Promise<void> {
    const { matchedCount } = await this.runs
      .updateOne(
        { _id: run._id, status: 'running', active: true },
        {
          $set: {
            status: 'done',
            active: false,
            finishedAt: new Date(),
            groups: outcome.groups,
            unsupported: outcome.unsupported,
          },
        },
        { session, runValidators: true },
      )
      .exec();
    if (matchedCount !== 1) throw new RunNoLongerRunningError();
  }

  /** Older ids only: a newer run, started after this one was released, must survive. */
  private async deleteEarlierRuns(
    run: SimilarityRun,
    session: ClientSession,
  ): Promise<void> {
    const earlier = await this.runs
      .find(
        { scopeKey: run.scopeKey, _id: { $lt: run._id } },
        { _id: 1 },
        { session },
      )
      .lean()
      .exec();
    const earlierIds = earlier.map((row) => uuidStr(row._id));
    await this.pairs
      .deleteMany({ run: { $in: earlierIds } }, { session })
      .exec();
    await this.runs
      .deleteMany({ _id: { $in: earlierIds } }, { session })
      .exec();
  }

  private async insertPairs(
    run: SimilarityRun,
    pairs: StoredPair[],
    session: ClientSession,
  ): Promise<void> {
    if (pairs.length === 0) return;
    const runId = uuidStr(run._id);
    await this.pairs.insertMany(
      pairs.map((pair) => toPairDocument(runId, pair)),
      { session },
    );
  }
}
