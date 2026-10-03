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
}
