import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Revision } from '@libs/database';
import type { ClientSession, Model } from 'mongoose';

@Injectable()
export class RevisionsRepository {
  constructor(
    @InjectModel(Revision.name) private readonly revisions: Model<Revision>,
  ) {}

  async append(
    entry: Pick<
      Revision,
      'entity' | 'entityId' | 'action' | 'userId' | 'changes' | 'comment'
    >,
    session?: ClientSession,
  ): Promise<void> {
    await this.revisions.create([entry], { session });
  }

  /** One page of history, newest first, through `{entity, entityId, createdAt, _id}`. */
  async page(
    entity: string,
    entityId: string,
    page: number,
    pageSize: number,
  ): Promise<{ items: Revision[]; total: number }> {
    const filter = { entity, entityId };
    const [items, total] = await Promise.all([
      this.revisions
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean<Revision[]>()
        .exec(),
      this.revisions.countDocuments(filter).exec(),
    ]);
    return { items, total };
  }

  /** Newest first, through `{entity, entityId, createdAt, _id}`. */
  list(entity: string, entityId: string, limit = 100): Promise<Revision[]> {
    return this.revisions
      .find({ entity, entityId })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .lean<Revision[]>()
      .exec();
  }
}
