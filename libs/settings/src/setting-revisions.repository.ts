import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { SettingRevision } from '@libs/database';
import type { ClientSession, Model } from 'mongoose';

@Injectable()
export class SettingRevisionsRepository {
  constructor(
    @InjectModel(SettingRevision.name)
    private readonly revisions: Model<SettingRevision>,
  ) {}

  async create(
    entry: Pick<
      SettingRevision,
      'key' | 'before' | 'after' | 'changedFields' | 'actor'
    >,
    session: ClientSession,
  ): Promise<void> {
    await this.revisions.create([entry], { session });
  }

  async list(key: string, page: number, pageSize: number) {
    const [items, total] = await Promise.all([
      this.revisions
        .find({ key })
        .sort({ _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      this.revisions.countDocuments({ key }),
    ]);
    return { items, total };
  }
}
