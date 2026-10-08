import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isUuid, NavigationItem, uuidStr } from '@libs/database';
import type { Model } from 'mongoose';

export type NavigationFields = Pick<
  NavigationItem,
  'key' | 'label' | 'path' | 'regex' | 'hidden' | 'order' | 'parentId'
>;

/** The navigation bar is a handful of rows: parent and child lookups scan the collection. */
@Injectable()
export class NavigationRepository {
  constructor(
    @InjectModel(NavigationItem.name)
    private readonly items: Model<NavigationItem>,
  ) {}

  async create(fields: NavigationFields): Promise<NavigationItem> {
    return (await this.items.create(fields)).toObject();
  }

  findById(id: string): Promise<NavigationItem | null> {
    return isUuid(id)
      ? this.items.findById(id).lean<NavigationItem>().exec()
      : Promise.resolve(null);
  }

  /** Null when the entry is gone. */
  update(
    id: string,
    changes: Partial<NavigationFields>,
  ): Promise<NavigationItem | null> {
    return this.items
      .findByIdAndUpdate(id, { $set: changes }, { new: true })
      .lean<NavigationItem>()
      .exec();
  }

  /** False when the entry was already gone. */
  async delete(id: string): Promise<boolean> {
    return (await this.items.deleteOne({ _id: id }).exec()).deletedCount > 0;
  }

  async hasChildren(id: string): Promise<boolean> {
    return (await this.items.exists({ parentId: id })) !== null;
  }

  /** Every entry's current parent, for cycle checks. */
  async parentMap(): Promise<Map<string, string | null>> {
    const rows = await this.items
      .find({}, { parentId: 1 })
      .lean<Pick<NavigationItem, '_id' | 'parentId'>[]>()
      .exec();
    return new Map(
      rows.map((row) => [
        uuidStr(row._id),
        row.parentId ? uuidStr(row.parentId) : null,
      ]),
    );
  }
}
