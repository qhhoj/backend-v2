import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { ContestAnnouncement } from '@libs/database';

@Injectable()
export class AnnouncementsRepository {
  constructor(
    @InjectModel(ContestAnnouncement.name)
    private readonly announcements: Model<ContestAnnouncement>,
  ) {}

  create(
    fields: Pick<
      ContestAnnouncement,
      'contest' | 'title' | 'description' | 'descriptionHtml'
    >,
  ) {
    return this.announcements.create(fields);
  }

  /** Newest first (ids are time-ordered). */
  async list(contestId: string, page: number, pageSize: number) {
    const filter = { contest: contestId };
    const [items, total] = await Promise.all([
      this.announcements
        .find(filter)
        .sort({ _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean<ContestAnnouncement[]>()
        .exec(),
      this.announcements.countDocuments(filter).exec(),
    ]);
    return { items, total };
  }

  findInContest(contestId: string, id: string) {
    return this.announcements
      .findOne({ _id: id, contest: contestId })
      .lean<ContestAnnouncement>()
      .exec();
  }

  /** The edited row, or null when it is not in this contest; `createdAt` is kept. */
  updateInContest(
    contestId: string,
    id: string,
    fields: Pick<
      ContestAnnouncement,
      'title' | 'description' | 'descriptionHtml'
    >,
  ) {
    return this.announcements
      .findOneAndUpdate(
        { _id: id, contest: contestId },
        { $set: fields },
        { new: true },
      )
      .lean<ContestAnnouncement>()
      .exec();
  }

  async deleteInContest(contestId: string, id: string): Promise<boolean> {
    const { deletedCount } = await this.announcements
      .deleteOne({ _id: id, contest: contestId })
      .exec();
    return deletedCount === 1;
  }
}
