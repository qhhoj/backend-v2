import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { FilterQuery, HydratedDocument, Model } from 'mongoose';
import { AppError, isDuplicateKey } from '@libs/common';
import { LIVE } from '@libs/contests';
import { ContestParticipation, isUuid, User, uuidStr } from '@libs/database';
import { VIRTUAL_JOIN_ATTEMPTS } from './rate-limits';

export type ParticipationDocument = HydratedDocument<ContestParticipation>;

@Injectable()
export class ParticipationsRepository {
  constructor(
    @InjectModel(ContestParticipation.name)
    private readonly participations: Model<ContestParticipation>,
    @InjectModel(User.name) private readonly users: Model<User>,
  ) {}

  findById(id: string): Promise<ParticipationDocument | null> {
    return isUuid(id)
      ? this.participations.findById(id).exec()
      : Promise.resolve(null);
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
    return (
      (await this.participations
        .findOneAndUpdate(
          { _id: participation._id, isRegistered: true },
          { $set: { isRegistered: false, realStart: now } },
          { new: true },
        )
        .exec()) ?? participation
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

  /** Lean usernames for boards of thousands of rows. */
  async usernamesOf(userIds: string[]): Promise<Map<string, string>> {
    const rows = await this.users
      .find({ _id: { $in: userIds } }, { username: 1 })
      .lean();
    return new Map(rows.map((row) => [uuidStr(row._id), row.username]));
  }
}
