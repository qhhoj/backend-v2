import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { FilterQuery, HydratedDocument, Model } from 'mongoose';
import { Share } from '@libs/database';
import type { ShareTakedown } from '@libs/database';

export type ShareDocument = HydratedDocument<Share>;

/** Lists never carry the source or the per-case rows. */
const LIST_PROJECTION = { 'copy.cases': 0, 'copy.batches': 0 } as const;

/** Not expired by time: the TTL monitor lags by up to a minute. */
export const activeFilter = (now: Date): FilterQuery<Share> => ({
  $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
});

@Injectable()
export class SharesRepository {
  constructor(@InjectModel(Share.name) private readonly shares: Model<Share>) {}

  findByCode(
    code: string,
    { withSource = false }: { withSource?: boolean } = {},
  ): Promise<Share | null> {
    const query = this.shares.findOne({ code });
    return (withSource ? query.select('+source') : query).lean<Share>().exec();
  }

  /** Throws the duplicate-key error on a taken code. */
  create(fields: Partial<Share>): Promise<ShareDocument> {
    return this.shares.create(fields);
  }

  countActive(userId: string, now: Date): Promise<number> {
    return this.shares
      .countDocuments({ createdBy: userId, ...activeFilter(now) })
      .exec();
  }

  /** Newest first. */
  async list(
    filter: FilterQuery<Share>,
    page: number,
    pageSize: number,
  ): Promise<{ items: Share[]; total: number }> {
    const [items, total] = await Promise.all([
      this.shares
        .find(filter, LIST_PROJECTION)
        .sort({ _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean<Share[]>()
        .exec(),
      this.shares.countDocuments(filter).exec(),
    ]);
    return { items, total };
  }

  /** List rows of these shares (no source, no case rows); missing ones are skipped. */
  findByIds(ids: readonly string[]): Promise<Share[]> {
    if (!ids.length) return Promise.resolve([]);
    return this.shares
      .find({ _id: { $in: ids } }, LIST_PROJECTION)
      .lean<Share[]>()
      .exec();
  }

  /** The share after the change; null when it is gone. */
  update(
    id: string,
    fields: Partial<Pick<Share, 'title' | 'expiresAt'>>,
  ): Promise<ShareDocument | null> {
    return this.shares
      .findOneAndUpdate({ _id: id }, { $set: fields }, { new: true })
      .exec();
  }

  /** Compare-and-set: takes down a live share, or restores a taken-down one (`takedown` null); false when it was not in the expected state. */
  async setTakedown(
    id: string,
    takedown: ShareTakedown | null,
  ): Promise<boolean> {
    const { modifiedCount } = await this.shares
      .updateOne(
        { _id: id, takenDown: takedown ? null : { $ne: null } },
        { $set: { takenDown: takedown } },
      )
      .exec();
    return modifiedCount === 1;
  }

  async remove(id: string): Promise<void> {
    await this.shares.deleteOne({ _id: id }).exec();
  }
}
