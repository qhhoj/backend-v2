import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ShortLink } from '@libs/database';
import type { FilterQuery, Model } from 'mongoose';

@Injectable()
export class ShortLinksRepository {
  constructor(
    @InjectModel(ShortLink.name) private readonly links: Model<ShortLink>,
  ) {}

  findByCode(code: string) {
    return this.links.findOne({ code }).exec();
  }

  findAutoByPath(path: string) {
    return this.links.findOne({ path, isAuto: true }).exec();
  }

  create(fields: Partial<ShortLink>) {
    return this.links.create(fields);
  }

  async list(
    filter: FilterQuery<ShortLink>,
    page: number,
    pageSize: number,
  ): Promise<{ items: ShortLink[]; total: number }> {
    const [items, total] = await Promise.all([
      this.links
        .find(filter)
        .sort({ _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .exec(),
      this.links.countDocuments(filter).exec(),
    ]);
    return { items, total };
  }

  async remove(code: string): Promise<ShortLink | null> {
    return this.links.findOneAndDelete({ code }).exec();
  }

  /** The event counter: `$inc` is the allowed exception to recompute-and-set. */
  async recordHit(id: string, at: Date): Promise<void> {
    await this.links
      .updateOne({ _id: id }, { $inc: { hits: 1 }, $set: { lastHitAt: at } })
      .exec();
  }
}
