import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { FilterQuery, HydratedDocument, Model } from 'mongoose';
import { AppError, isDuplicateKey } from '@libs/common';
import { LIVE } from '@libs/contests';
import {
  Contest,
  ContestParticipation,
  ContestSubmission,
  isUuid,
  Submission,
  User,
  uuidStr,
} from '@libs/database';
import { VIRTUAL_JOIN_ATTEMPTS } from '../core/rate-limits';

export type ParticipationDocument = HydratedDocument<ContestParticipation>;

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
          .countDocuments({ _id: { $in: ids }, status: { $nin: ['IE', 'PD'] } })
          .exec()
      : 0;
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

  /** The user's live rows, through `{user}`. */
  liveRowsOf(userId: string): Promise<ContestParticipation[]> {
    return this.participations
      .find({ user: userId, virtual: LIVE })
      .lean<ContestParticipation[]>()
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

  /** Live or spectating: the unique index makes concurrent joins meet on one row. */
  async findOrCreate(
    contestId: string,
    userId: string,
    virtual: number,
    now: Date,
  ): Promise<ParticipationDocument> {
    const key = { contest: contestId, user: userId, virtual };
    try {
      return await this.participations
        .findOneAndUpdate(
          key,
          { $setOnInsert: { realStart: now } },
          { upsert: true, new: true },
        )
        .exec();
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      return (await this.participations.findOne(key).exec())!;
    }
  }

  /** Legacy: the next virtual number, retried while concurrent joins take it. */
  async createVirtual(
    contestId: string,
    userId: string,
    now: Date,
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
        });
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
      }
    }
    throw new AppError('conflict', 409, 'Too many joins at once; try again');
  }

  /** Null when a live participation already exists. `placeholder` fills `realStart` until the first join. */
  async register(
    contestId: string,
    userId: string,
    placeholder: Date,
  ): Promise<ParticipationDocument | null> {
    try {
      return await this.participations.create({
        contest: contestId,
        user: userId,
        virtual: LIVE,
        realStart: placeholder,
        isRegistered: true,
      });
    } catch (error) {
      if (isDuplicateKey(error)) return null;
      throw error;
    }
  }

  /** The first join after registering starts the participation's clock (legacy rewrote the 1970 `real_start`). */
  async start(
    participation: ParticipationDocument,
    now: Date,
  ): Promise<ParticipationDocument> {
    const started = await this.participations
      .findOneAndUpdate(
        { _id: participation._id, isRegistered: true },
        { $set: { isRegistered: false, realStart: now } },
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

  async list(
    filter: FilterQuery<ContestParticipation>,
    page: number,
    pageSize: number,
  ): Promise<{ items: ParticipationDocument[]; total: number }> {
    const [items, total] = await Promise.all([
      this.participations
        .find(filter)
        .sort({ virtual: 1, _id: 1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .exec(),
      this.participations.countDocuments(filter).exec(),
    ]);
    return { items, total };
  }

  /** Legacy `APIContestParticipationList` pages: counted, by id. */
  async legacyPage(
    filter: FilterQuery<ContestParticipation>,
    page: number,
    pageSize: number,
  ): Promise<{ items: ContestParticipation[]; total: number }> {
    const [items, total] = await Promise.all([
      this.participations
        .find(filter, { formatData: 0, frozenFormatData: 0 })
        .sort({ _id: 1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean<ContestParticipation[]>()
        .exec(),
      this.participations.countDocuments(filter).exec(),
    ]);
    return { items, total };
  }

  /** Live rows, plus virtual ones on request; spectators never (legacy `virtual__gt=SPECTATE`). Sorted by the caller. */
  rankingRows(
    contestId: string,
    withVirtual: boolean,
  ): Promise<ContestParticipation[]> {
    return this.participations
      .find({
        contest: contestId,
        virtual: withVirtual ? { $gte: LIVE } : LIVE,
      })
      .lean<ContestParticipation[]>()
      .exec();
  }

  /** Lean usernames for boards of thousands of rows. */
  async usernamesOf(userIds: string[]): Promise<Map<string, string>> {
    const rows = await this.users
      .find({ _id: { $in: userIds } }, { username: 1 })
      .lean();
    return new Map(rows.map((row) => [uuidStr(row._id), row.username]));
  }
}
