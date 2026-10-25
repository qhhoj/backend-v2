import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { FilterQuery, HydratedDocument, Model } from 'mongoose';
import { AppError, escapeRegExp, isDuplicateKey } from '@libs/common';
import { LIVE } from '@libs/contests';
import type { ParticipationTimes } from '@libs/contests';
import {
  Contest,
  ContestParticipation,
  ContestSubmission,
  isUuid,
  Submission,
  toUuid,
  UNCOUNTED_ATTEMPT_STATUSES,
  User,
  uuidStr,
} from '@libs/database';
import { VIRTUAL_JOIN_ATTEMPTS } from '../core/rate-limits';
import type { UserSummaryResponse } from '../../problems/core/dto/user-summary.response';
import type { OwnSubmission } from './viewer-problem-results';

export type ParticipationDocument = HydratedDocument<ContestParticipation>;

/** The fields `liveStatusOf` and `hasParticipationEnded` read, plus the ids a list page matches on. */
export type OwnParticipationRow = Pick<
  ContestParticipation,
  '_id' | 'contest' | 'virtual' | 'realStart' | 'isRegistered'
>;

/** What a participation stores when the user accepted the contest rules. */
export interface RulesAcceptance {
  rulesAcceptedAt: Date;
  rulesAcceptedRevision: number;
}

export interface ParticipationKey {
  contestId: string;
  userId: string;
  virtual: number;
}

@Injectable()
export class ParticipationsRepository {
  constructor(
    @InjectModel(ContestParticipation.name)
    private readonly participations: Model<ContestParticipation>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Contest.name) private readonly contests: Model<Contest>,
    @InjectModel(Submission.name)
    private readonly submissions: Model<Submission>,
    @InjectModel(ContestSubmission.name)
    private readonly contestSubmissions: Model<ContestSubmission>,
  ) {}

  findById(id: string): Promise<ParticipationDocument | null> {
    return isUuid(id)
      ? this.participations.findById(id).exec()
      : Promise.resolve(null);
  }

  /** The runs with these ids, keyed by id, with the fields that place a submission in time (`participationStart`); unknown and malformed ids are skipped. */
  async runsByIds(
    ids: readonly string[],
  ): Promise<Map<string, ParticipationTimes>> {
    const valid = ids.filter(isUuid);
    if (!valid.length) return new Map();
    const rows = await this.participations
      .find(
        { _id: { $in: valid } },
        { virtual: 1, realStart: 1, isRegistered: 1 },
      )
      .lean<(ParticipationTimes & { _id: unknown })[]>()
      .exec();
    return new Map(rows.map((row) => [uuidStr(row._id), row]));
  }

  /** Legacy `get_contest_submission_count`: the participation's submissions to the problem, IE and PD excluded. */
  async countAttempts(
    participationId: string,
    problemId: string,
  ): Promise<number> {
    const ids = await this.contestSubmissions
      .distinct('_id', { participation: participationId, problem: problemId })
      .exec();
    return ids.length
      ? this.submissions
          .countDocuments({
            _id: { $in: ids },
            status: { $nin: [...UNCOUNTED_ATTEMPT_STATUSES] },
          })
          .exec()
      : 0;
  }

  /** Every submission of the participation with its problem and status: `{participation, problem}` index, then `_id` reads of only those submissions. */
  async submissionStatusesOf(
    participationId: string,
  ): Promise<OwnSubmission[]> {
    const rows = await this.contestSubmissions
      .find({ participation: participationId }, { problem: 1 })
      .lean()
      .exec();
    if (!rows.length) return [];
    const problemOf = new Map(
      rows.map((row) => [uuidStr(row._id), uuidStr(row.problem)]),
    );
    const statuses = await this.submissions
      .find({ _id: { $in: rows.map((row) => row._id) } }, { status: 1 })
      .lean()
      .exec();
    return statuses.map((row) => ({
      problem: problemOf.get(uuidStr(row._id))!,
      status: row.status,
    }));
  }

  findOne(
    contestId: string,
    userId: string,
    virtual: number,
  ): Promise<ParticipationDocument | null> {
    return this.participations
      .findOne({ contest: contestId, user: userId, virtual })
      .exec();
  }

  liveOf(
    userId: string,
    contestIds: string[],
  ): Promise<ContestParticipation[]> {
    return this.participations
      .find({ user: userId, contest: { $in: contestIds }, virtual: LIVE })
      .lean<ContestParticipation[]>()
      .exec();
  }

  /** The user's rows (live, spectating, virtual) in these contests: `$in` on the first field of the unique `{contest, user, virtual}` index reads only the matching keys. */
  ownRowsIn(
    userId: string,
    contestIds: readonly string[],
  ): Promise<OwnParticipationRow[]> {
    if (!contestIds.length) return Promise.resolve([]);
    return this.participations
      .find(
        { contest: { $in: [...contestIds] }, user: userId },
        { contest: 1, virtual: 1, realStart: 1, isRegistered: 1 },
      )
      .hint({ contest: 1, user: 1, virtual: 1 })
      .lean<OwnParticipationRow[]>()
      .exec();
  }

  /** The participation `users.currentParticipation` points at, null when none (or gone). */
  async findCurrentOf(userId: string): Promise<ParticipationDocument | null> {
    const user = await this.users
      .findById(userId, { currentParticipation: 1 })
      .lean();
    return user?.currentParticipation
      ? this.participations.findById(user.currentParticipation).exec()
      : null;
  }

  async currentIdOf(userId: string): Promise<string | null> {
    const user = await this.users
      .findById(userId, { currentParticipation: 1 })
      .lean();
    return user?.currentParticipation
      ? uuidStr(user.currentParticipation)
      : null;
  }

  async setCurrent(userId: string, participationId: string): Promise<void> {
    await this.users
      .updateOne(
        { _id: userId },
        { $set: { currentParticipation: participationId } },
      )
      .exec();
  }

  /** Compare-and-set: a join that replaced the pointer meanwhile is never undone. */
  async clearCurrent(userId: string, participationId: string): Promise<void> {
    await this.users
      .updateOne(
        { _id: userId, currentParticipation: participationId },
        { $set: { currentParticipation: null } },
      )
      .exec();
  }

  async setDisqualified(
    id: string,
    isDisqualified: boolean,
  ): Promise<ParticipationDocument> {
    return (await this.participations
      .findByIdAndUpdate(id, { $set: { isDisqualified } }, { new: true })
      .exec())!;
  }

  /** Legacy `check_ban` count: the user's disqualified participations in contests that are not organisation-private. */
  async countOpenDisqualifications(userId: string): Promise<number> {
    const rows = await this.participations
      .find({ user: userId, isDisqualified: true }, { contest: 1 })
      .lean();
    if (!rows.length) return 0;
    const open = new Set(
      (
        await this.contests
          .find(
            {
              _id: { $in: rows.map((row) => row.contest) },
              isOrganizationPrivate: false,
            },
            { _id: 1 },
          )
          .lean()
      ).map((contest) => uuidStr(contest._id)),
    );
    return rows.filter((row) => open.has(uuidStr(row.contest))).length;
  }

  /** Live or spectating: the unique index makes concurrent joins meet on one row; the acceptance is stored with the insert, so a row never exists without it. */
  async findOrCreate(
    key: ParticipationKey,
    entry: { now: Date; acceptance: RulesAcceptance | null },
  ): Promise<ParticipationDocument> {
    const filter = {
      contest: key.contestId,
      user: key.userId,
      virtual: key.virtual,
    };
    try {
      return await this.participations
        .findOneAndUpdate(
          filter,
          { $setOnInsert: { realStart: entry.now, ...entry.acceptance } },
          { upsert: true, new: true },
        )
        .exec();
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      return (await this.participations.findOne(filter).exec())!;
    }
  }

  /** Legacy: the next virtual number, retried while concurrent joins take it. */
  async createVirtual(
    contestId: string,
    userId: string,
    now: Date,
    acceptance: RulesAcceptance | null,
  ): Promise<ParticipationDocument> {
    for (let attempt = 0; attempt < VIRTUAL_JOIN_ATTEMPTS; attempt += 1) {
      const [highest] = await this.participations
        .find({ contest: contestId, user: userId }, { virtual: 1 })
        .sort({ virtual: -1 })
        .limit(1)
        .lean();
      try {
        return await this.participations.create({
          contest: contestId,
          user: userId,
          virtual: Math.max((highest?.virtual ?? 0) + 1, 1),
          realStart: now,
          ...acceptance,
        });
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
      }
    }
    throw new AppError('conflict', 409, 'Too many joins at once; try again');
  }

  /** Null when a live participation already exists. `placeholder` fills `realStart` until the first join. */
  register(
    contestId: string,
    userId: string,
    placeholder: Date,
    acceptance: RulesAcceptance | null,
  ): Promise<ParticipationDocument | null> {
    return this.insertLive(contestId, userId, {
      realStart: placeholder,
      isRegistered: true,
      ...acceptance,
    });
  }

  /** Null when a live participation already exists (unique `{contest, user, virtual}`). */
  async insertLive(
    contestId: string,
    userId: string,
    fields: Pick<ContestParticipation, 'realStart'> &
      Partial<ContestParticipation>,
  ): Promise<ParticipationDocument | null> {
    try {
      return await this.participations.create({
        ...fields,
        contest: contestId,
        user: userId,
        virtual: LIVE,
      });
    } catch (error) {
      if (isDuplicateKey(error)) return null;
      throw error;
    }
  }

  /** The first join after registering starts the participation's clock (legacy rewrote the 1970 `real_start`) and stores the acceptance of rules edited since the registration. */
  async start(
    participation: ParticipationDocument,
    now: Date,
    acceptance: RulesAcceptance | null = null,
  ): Promise<ParticipationDocument> {
    const started = await this.participations
      .findOneAndUpdate(
        { _id: participation._id, isRegistered: true },
        { $set: { isRegistered: false, realStart: now, ...acceptance } },
        { new: true },
      )
      .exec();
    // Lost the race: another join started it, so return its row, not the stale one.
    return (
      started ??
      (await this.participations.findById(participation._id).exec()) ??
      participation
    );
  }

  /** Legacy `update_user_count`: live rows (registrations included) and virtual rows. */
  async countsOf(
    contestId: string,
  ): Promise<{ userCount: number; virtualCount: number }> {
    const [userCount, virtualCount] = await Promise.all([
      this.participations
        .countDocuments({ contest: contestId, virtual: LIVE })
        .exec(),
      this.participations
        .countDocuments({ contest: contestId, virtual: { $gt: LIVE } })
        .exec(),
    ]);
    return { userCount, virtualCount };
  }

  /** Default order: live before virtual, oldest first. */
  async list(
    filter: FilterQuery<ContestParticipation>,
    page: number,
    pageSize: number,
    order: Record<string, 1 | -1> = { virtual: 1, _id: 1 },
  ): Promise<{ items: ParticipationDocument[]; total: number }> {
    const [items, total] = await Promise.all([
      this.participations
        .find(filter)
        .sort(order)
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .exec(),
      this.participations.countDocuments(filter).exec(),
    ]);
    return { items, total };
  }

  /** Live rows, plus virtual ones on request; spectators never (legacy `virtual__gt=SPECTATE`). Sorted by the caller. */
  rankingRows(
    contestId: string,
    { withVirtual }: { withVirtual: boolean },
  ): Promise<ContestParticipation[]> {
    return this.participations
      .find({
        contest: contestId,
        virtual: withVirtual ? { $gte: LIVE } : LIVE,
      })
      .lean<ContestParticipation[]>()
      .exec();
  }

  /** One aggregate over the contest's live rows through `{contest, virtual}`, returning one document: per problem, the rows whose cell (frozen when asked) is worth the problem's full points. */
  async solverCountsOf(
    contestId: string,
    problems: readonly { problemId: string; points: number }[],
    isFrozenView: boolean,
  ): Promise<Map<string, number>> {
    const cells = isFrozenView ? '$frozenFormatData' : '$formatData';
    // Mongo form of `isSolvedCell` (libs/contests first-solves.ts): keep in step with it.
    const pointsOf = (problemId: string) => ({
      $getField: {
        field: 'points',
        input: { $getField: { field: problemId, input: cells } },
      },
    });
    const sums = Object.fromEntries(
      problems.map(({ problemId, points }, index) => [
        `problem${index}`,
        {
          $sum: {
            $cond: [
              { $and: [points > 0, { $eq: [pointsOf(problemId), points] }] },
              1,
              0,
            ],
          },
        },
      ]),
    );
    const [row] = await this.participations
      .aggregate<Record<string, number>>([
        { $match: { contest: toUuid(contestId), virtual: LIVE } },
        { $group: { _id: null, ...sums } },
      ])
      .hint({ contest: 1, virtual: 1 })
      .exec();
    return new Map(
      problems.map(({ problemId }, index) => [
        problemId,
        row?.[`problem${index}`] ?? 0,
      ]),
    );
  }

  /** Lean user references for boards of thousands of rows. */
  async summariesOf(
    userIds: string[],
  ): Promise<Map<string, UserSummaryResponse>> {
    const rows = await this.users
      .find({ _id: { $in: userIds } }, { username: 1, rating: 1 })
      .lean();
    return new Map(
      rows.map((row) => {
        const id = uuidStr(row._id);
        return [id, { id, username: row.username, rating: row.rating }];
      }),
    );
  }

  /** Users with a participation in the contest whose username contains `text`, case-insensitive: one aggregate over the contest's own rows, never a scan of every user. */
  async userIdsMatching(contestId: string, text: string): Promise<string[]> {
    const rows = await this.participations
      .aggregate<{ _id: unknown }>([
        { $match: { contest: toUuid(contestId) } },
        { $group: { _id: '$user' } },
        {
          $lookup: {
            from: this.users.collection.collectionName,
            localField: '_id',
            foreignField: '_id',
            as: 'match',
            pipeline: [
              { $match: { username: new RegExp(escapeRegExp(text), 'i') } },
              { $project: { _id: 1 } },
            ],
          },
        },
        { $match: { 'match.0': { $exists: true } } },
      ])
      .exec();
    return rows.map((row) => uuidStr(row._id));
  }
}
