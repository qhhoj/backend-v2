import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Revision } from '@libs/database';
import type { Model } from 'mongoose';

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
  ): Promise<void> {
    await this.revisions.create(entry);
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
