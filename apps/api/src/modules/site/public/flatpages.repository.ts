import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { escapeRegExp } from '@libs/common';
import { Flatpage, isUuid } from '@libs/database';
import type { FilterQuery, Model } from 'mongoose';

export type FlatpageFields = Pick<
  Flatpage,
  'url' | 'title' | 'content' | 'contentHtml' | 'registrationRequired'
>;

@Injectable()
export class FlatpagesRepository {
  constructor(
    @InjectModel(Flatpage.name) private readonly flatpages: Model<Flatpage>,
  ) {}

  /** Through the unique `{url}` index; the markdown source is not loaded. */
  findByUrl(url: string): Promise<Flatpage | null> {
    return this.flatpages
      .findOne({ url }, { content: 0 })
      .lean<Flatpage>()
      .exec();
  }

  /** Staff writes; the service renders `contentHtml` before it calls. */
  async create(fields: FlatpageFields): Promise<Flatpage> {
    return (await this.flatpages.create(fields)).toObject();
  }

  /** The full row (with the Markdown source); null for an unknown or malformed id. */
  findById(id: string): Promise<Flatpage | null> {
    return isUuid(id)
      ? this.flatpages.findById(id).lean<Flatpage>().exec()
      : Promise.resolve(null);
  }

  /** One atomic `$set`: a duplicate url changes nothing. Null when the page is gone. */
  update(
    id: string,
    changes: Partial<FlatpageFields>,
  ): Promise<Flatpage | null> {
    return isUuid(id)
      ? this.flatpages
          .findByIdAndUpdate(id, { $set: changes }, { new: true })
          .lean<Flatpage>()
          .exec()
      : Promise.resolve(null);
  }

  /** The deleted row, or null when it was already gone. */
  delete(id: string): Promise<Flatpage | null> {
    return isUuid(id)
      ? this.flatpages.findByIdAndDelete(id).lean<Flatpage>().exec()
      : Promise.resolve(null);
  }

  /** By url, through the unique index; the Markdown source is not loaded. */
  /** `search`: the url or the title contains it, any case. */
  async list(
    page: number,
    pageSize: number,
    search = '',
  ): Promise<{ items: Flatpage[]; total: number }> {
    const pattern = { $regex: escapeRegExp(search), $options: 'i' };
    const filter: FilterQuery<Flatpage> = search
      ? { $or: [{ url: pattern }, { title: pattern }] }
      : {};
    const [items, total] = await Promise.all([
      this.flatpages
        .find(filter, { content: 0, contentHtml: 0 })
        .sort({ url: 1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean<Flatpage[]>()
        .exec(),
      search
        ? this.flatpages.countDocuments(filter)
        : this.flatpages.estimatedDocumentCount(),
    ]);
    return { items, total };
  }
}
