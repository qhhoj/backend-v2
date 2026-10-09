import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { TICKET_CANNED_REPLIES_PAGE_SIZE } from '@libs/community';
import { isUuid, TicketCannedReply } from '@libs/database';
import type { Model } from 'mongoose';

type Fields = Pick<TicketCannedReply, 'title' | 'body' | 'order' | 'createdBy'>;

@Injectable()
export class CannedRepliesRepository {
  constructor(
    @InjectModel(TicketCannedReply.name)
    private readonly replies: Model<TicketCannedReply>,
  ) {}

  /** Through `{order, _id}`. */
  async page(
    page: number,
  ): Promise<{ rows: TicketCannedReply[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.replies
        .find()
        .sort({ order: 1, _id: 1 })
        .skip((page - 1) * TICKET_CANNED_REPLIES_PAGE_SIZE)
        .limit(TICKET_CANNED_REPLIES_PAGE_SIZE)
        .lean<TicketCannedReply[]>()
        .exec(),
      this.replies.countDocuments().exec(),
    ]);
    return { rows, total };
  }

  count(): Promise<number> {
    return this.replies.countDocuments().exec();
  }

  /** One after the highest `order`, or 0 when there is none. */
  async nextOrder(): Promise<number> {
    const last = await this.replies
      .findOne({}, { order: 1 })
      .sort({ order: -1 })
      .lean()
      .exec();
    return last ? last.order + 1 : 0;
  }

  async create(fields: Fields): Promise<TicketCannedReply> {
    return (await this.replies.create(fields)).toObject();
  }

  async update(
    id: string,
    changes: Partial<Pick<Fields, 'title' | 'body' | 'order'>>,
  ): Promise<TicketCannedReply | null> {
    if (!isUuid(id)) return null;
    return this.replies
      .findByIdAndUpdate(id, { $set: changes }, { new: true })
      .lean<TicketCannedReply>()
      .exec();
  }

  async remove(id: string): Promise<boolean> {
    if (!isUuid(id)) return false;
    const { deletedCount } = await this.replies.deleteOne({ _id: id }).exec();
    return deletedCount === 1;
  }
}
