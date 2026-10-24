import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type {
  Connection,
  FilterQuery,
  HydratedDocument,
  Model,
} from 'mongoose';
import {
  ContestSubmission,
  IN_FLIGHT_STATUSES,
  isUuid,
  newId,
  Submission,
  toUuid,
  SubmissionSource,
  UNFINISHED_STATUSES,
  uuidStr,
} from '@libs/database';
import {
  effectsDue,
  JUDGE_COMMAND_BATCH,
  requeueUpdate,
  SOLVED_FILTER,
} from '@libs/judging';
import type { OverriddenScore } from '../actions/score-override';
import { NOT_OVERRIDABLE_STATUSES } from './submission-access';
import type { CaseHead } from './test-summary';

export type SubmissionDocument = HydratedDocument<Submission>;
const STATE_FIELDS = {
  status: 1,
  result: 1,
  points: 1,
  casePoints: 1,
  caseTotal: 1,
  currentTestcase: 1,
} as const;
/** What the contest block reads of a submission's contest row. */
export type ContestRowFields = Pick<
  ContestSubmission,
  'points' | 'participation'
>;
export type SubmissionState = Pick<
  Submission,
  '_id' | keyof typeof STATE_FIELDS
>;

export type NewSubmission = Pick<Submission, 'user' | 'problem' | 'language'> &
  Partial<
    Pick<
      Submission,
      | 'status'
      | 'priority'
      | 'contest'
      | 'lockedAfter'
      | 'isPretested'
      | 'pinnedJudge'
    >
  >;
export type NewContestSubmission = Pick<
  ContestSubmission,
  'participation' | 'contest' | 'problem' | 'isPretest'
>;

@Injectable()
export class SubmissionsRepository {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Submission.name)
    private readonly submissions: Model<Submission>,
    @InjectModel(SubmissionSource.name)
    private readonly sources: Model<SubmissionSource>,
    @InjectModel(ContestSubmission.name)
    private readonly contestSubmissions: Model<ContestSubmission>,
  ) {}

  /** The row, its source and (in a contest) its contest row in one transaction, so the bridge never claims a submission without a source and effects never miss its participation. */
  async create(
    fields: NewSubmission,
    source: string,
    contestEntry: NewContestSubmission | null = null,
  ): Promise<string> {
    const id = newId();
    await this.connection.transaction(async (session) => {
      // `create` with a session takes an array.
      await this.sources.create([{ _id: id, source }], { session });
      await this.submissions.create([{ _id: id, ...fields }], { session });
      if (contestEntry)
        await this.contestSubmissions.create([{ _id: id, ...contestEntry }], {
          session,
        });
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
  findById(
    id: string,
    { withCases = false }: { withCases?: boolean } = {},
  ): Promise<SubmissionDocument | null> {
    if (!isUuid(id)) return Promise.resolve(null);
    const query = this.submissions.findById(id);
    return (withCases ? query.select('+cases') : query).exec();
  }

  /** The contest rows (stored points and participation) of these submissions, keyed by submission id: one `_id` lookup; a submission outside a contest has none. */
  async contestRows(
    ids: readonly string[],
  ): Promise<Map<string, ContestRowFields>> {
    if (!ids.length) return new Map();
    const rows = await this.contestSubmissions
      .find({ _id: { $in: [...ids] } }, { points: 1, participation: 1 })
      .lean<(ContestRowFields & { _id: unknown })[]>()
      .exec();
    return new Map(rows.map((row) => [uuidStr(row._id), row]));
  }

  /** Just what a stream's `state` shows. */
  findState(id: string): Promise<SubmissionState | null> {
    if (!isUuid(id)) return Promise.resolve(null);
    return this.submissions
      .findById(id, STATE_FIELDS)
      .lean<SubmissionState>()
      .exec();
  }

  /** The submission's contest id, null for practice; undefined when there is no such submission. */
  async findContestId(id: string): Promise<string | null | undefined> {
    if (!isUuid(id)) return undefined;
    const row = await this.submissions
      .findById(id, { contest: 1 })
      .lean<Pick<Submission, '_id' | 'contest'>>()
      .exec();
    if (!row) return undefined;
    return row.contest ? uuidStr(row.contest) : null;
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

  count(filter: FilterQuery<Submission>): Promise<number> {
    return this.submissions.countDocuments(filter).exec();
  }

  /** The first `cap` cases (status and batch) and the stored case count of each submission, keyed by id, read in the database so the 10000-row arrays never load; a primary-key lookup. */
  async caseHeads(
    ids: readonly string[],
    cap: number,
  ): Promise<Map<string, { head: CaseHead[]; count: number }>> {
    if (!ids.length) return new Map();
    const rows = await this.submissions.aggregate<{
      _id: unknown;
      head: CaseHead[];
      count: number;
    }>([
      { $match: { _id: { $in: ids.map(toUuid) } } },
      {
        $project: {
          head: {
            $map: {
              input: { $slice: [{ $ifNull: ['$cases', []] }, cap] },
              in: { status: '$$this.status', batch: '$$this.batch' },
            },
          },
          count: { $size: { $ifNull: ['$cases', []] } },
        },
      },
    ]);
    return new Map(
      rows.map(({ _id, head, count }) => [uuidStr(_id), { head, count }]),
    );
  }

  /** Legacy SOLVED visibility, by `IS_SOLVED` (every case point earned) rather than legacy's "AC worth the problem's full points". */
  async hasSolved(userId: string, problemId: string): Promise<boolean> {
    return (
      (await this.submissions.exists({
        user: userId,
        problem: problemId,
        ...SOLVED_FILTER,
      })) !== null
    );
  }

  /** QU → AB in one step; false when the bridge claimed it meanwhile (the abort command then terminates it). */
  async abortQueued(id: string): Promise<boolean> {
    const { modifiedCount } = await this.submissions
      .updateOne(
        { _id: id, status: 'QU' },
        { $set: { status: 'AB', result: 'AB', points: 0, ...effectsDue() } },
      )
      .exec();
    return modifiedCount === 1;
  }

  /** Back to QU at `priority` with every result cleared (`requeueUpdate`), except while a judge holds it (P/G) or it awaits its contest's end (PD). Returns how many were reset. */
  async resetForJudging(ids: string[], priority: number): Promise<number> {
    const { modifiedCount } = await this.submissions
      .updateMany(
        {
          _id: { $in: ids },
          status: { $nin: [...IN_FLIGHT_STATUSES, 'PD'] },
        },
        requeueUpdate(priority),
      )
      .exec();
    return modifiedCount;
  }

  /** Legacy `Submission.reject`, once judging is over: result RJ, no points, cases cleared. */
  async reject(id: string): Promise<boolean> {
    const { matchedCount } = await this.submissions
      .updateOne(
        { _id: id, status: { $nin: [...UNFINISHED_STATUSES] } },
        {
          $set: {
            result: 'RJ',
            points: 0,
            casePoints: 0,
            cases: [],
            ...effectsDue(),
          },
        },
      )
      .exec();
    return matchedCount === 1;
  }

  /** A manual verdict and score on a finished row (D, CE, IE, AB): it reads as graded, and its effects are due. False while it is queued, judged or a pending final submission, or once a judging after `judgeGeneration` was read has claimed it. */
  async overrideScore(
    id: string,
    judgeGeneration: number,
    fields: OverriddenScore & {
      lockedAfter?: Date;
      error?: null;
      cases?: Submission['cases'];
    },
  ): Promise<boolean> {
    const { matchedCount } = await this.submissions
      .updateOne(
        {
          _id: id,
          judgeGeneration,
          status: { $nin: [...NOT_OVERRIDABLE_STATUSES] },
        },
        { $set: { status: 'D', ...fields, ...effectsDue() } },
      )
      .exec();
    return matchedCount === 1;
  }

  /** The newest `limit` matches, without the error log. */
  newest(
    filter: FilterQuery<Submission>,
    limit: number,
  ): Promise<SubmissionDocument[]> {
    return this.submissions
      .find(filter, { error: 0 })
      .sort({ _id: -1 })
      .limit(limit)
      .exec();
  }

  /** Distinct problem ids of the matches. */
  async problemIdsOf(filter: FilterQuery<Submission>): Promise<string[]> {
    const ids: unknown[] = await this.submissions
      .distinct('problem', filter)
      .exec();
    return ids.map((id) => uuidStr(id));
  }

  /** Sets or clears the lock. */
  async setLockedAfter(id: string, lockedAfter: Date | null): Promise<void> {
    await this.submissions
      .updateOne({ _id: id }, { $set: { lockedAfter } })
      .exec();
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
