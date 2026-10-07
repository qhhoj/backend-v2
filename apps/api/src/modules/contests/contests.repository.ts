import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { FilterQuery, HydratedDocument, Model, SortOrder } from 'mongoose';
import { AppError, isDuplicateKey } from '@libs/common';
import { FREEZE_FORMATS, LIVE } from '@libs/contests';
import {
  Contest,
  ContestParticipation,
  ContestSubmission,
  isUuid,
  Rating,
  Submission,
  uuidStr,
} from '@libs/database';
import { JUDGEABLE_PENDING } from '@libs/judging';

export type ContestDocument = HydratedDocument<Contest>;

/** Submissions updated per write when a lock moves. */
const LOCK_CHUNK = 1000;
const LIST_PROJECTION = { description: 0, descriptionHtml: 0 } as const;

@Injectable()
export class ContestsRepository {
  constructor(
    @InjectModel(Contest.name) private readonly contests: Model<Contest>,
    @InjectModel(ContestParticipation.name)
    private readonly participations: Model<ContestParticipation>,
    @InjectModel(ContestSubmission.name)
    private readonly contestSubmissions: Model<ContestSubmission>,
    @InjectModel(Submission.name)
    private readonly submissions: Model<Submission>,
    @InjectModel(Rating.name) private readonly ratings: Model<Rating>,
  ) {}

  /** Through the `{contest, user}` index. */
  async hasRatings(contestId: string): Promise<boolean> {
    return (await this.ratings.exists({ contest: contestId })) !== null;
  }

  findByKey(key: string): Promise<ContestDocument | null> {
    return this.contests.findOne({ key }).exec();
  }

  async setBanned(
    contestId: string,
    userId: string,
    banned: boolean,
  ): Promise<void> {
    await this.contests
      .updateOne(
        { _id: contestId },
        banned
          ? { $addToSet: { bannedUsers: userId } }
          : { $pull: { bannedUsers: userId } },
      )
      .exec();
  }

  findById(id: string): Promise<ContestDocument | null> {
    return isUuid(id)
      ? this.contests.findById(id).exec()
      : Promise.resolve(null);
  }

  /** Contests that can hide a submission list now: not ended, a scoreboard other than V, or a freezing format with a freeze (which outlives the end). Ended, always-visible boards (most contests) are never read. */
  candidatesHidingSubmissions(now: Date): Promise<Contest[]> {
    return this.contests
      .find(
        {
          $or: [
            { endTime: { $gte: now } },
            { scoreboardVisibility: { $ne: 'V' } },
            {
              formatName: { $in: FREEZE_FORMATS },
              frozenLastMinutes: { $gt: 0 },
            },
          ],
        },
        { description: 0, descriptionHtml: 0, problems: 0 },
      )
      .lean<Contest[]>()
      .exec();
  }

  /** List rows never carry the description. */
  async list(
    filter: FilterQuery<Contest>,
    sort: Record<string, SortOrder>,
    page: number,
    pageSize: number,
  ): Promise<{ items: Contest[]; total: number }> {
    const [items, total] = await Promise.all([
      this.contests
        .find(filter, LIST_PROJECTION)
        .sort(sort)
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean<Contest[]>()
        .exec(),
      this.contests.countDocuments(filter).exec(),
    ]);
    return { items, total };
  }

  async create(fields: Partial<Contest>): Promise<ContestDocument> {
    try {
      return await this.contests.create(fields);
    } catch (error) {
      if (isDuplicateKey(error, 'key'))
        throw new AppError('conflict', 409, 'A contest with this key exists');
      throw error;
    }
  }

  async update(
    id: string,
    changes: Partial<Contest>,
  ): Promise<ContestDocument> {
    return (await this.contests
      .findByIdAndUpdate(
        id,
        { $set: changes },
        { new: true, runValidators: true },
      )
      .exec())!;
  }

  /** Submissions final judging would still requeue (`PD` and not rejected, held by `final_submission`) in the contest. */
  async hasPendingSubmissions(contestId: string): Promise<boolean> {
    return (
      (await this.submissions
        .exists({ contest: contestId, ...JUDGEABLE_PENDING })
        .exec()) !== null
    );
  }

  /** Legacy `set_locked_after`: the lock is copied onto every live submission of the contest, a chunk at a time. */
  async propagateLock(
    contestId: string,
    lockedAfter: Date | null,
  ): Promise<void> {
    const live = await this.participations
      .distinct('_id', { contest: contestId, virtual: LIVE })
      .exec();
    let chunk: string[] = [];
    const flush = async () => {
      if (chunk.length)
        await this.submissions
          .updateMany({ _id: { $in: chunk } }, { $set: { lockedAfter } })
          .exec();
      chunk = [];
    };
    const cursor = this.contestSubmissions
      .find({ participation: { $in: live } }, { _id: 1 })
      .lean()
      .cursor();
    for await (const row of cursor) {
      chunk.push(uuidStr(row._id));
      if (chunk.length === LOCK_CHUNK) await flush();
    }
    await flush();
  }

  async setCounts(
    contestId: string,
    counts: { userCount: number; virtualCount: number },
  ): Promise<void> {
    await this.contests.updateOne({ _id: contestId }, { $set: counts }).exec();
  }
}
