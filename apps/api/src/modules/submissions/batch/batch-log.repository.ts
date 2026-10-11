import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Revision } from '@libs/database';
import { RevisionsRepository } from '../../problems/core/revisions.repository';
import type {
  BatchAction,
  SubmissionBatchFilterDto,
} from './dto/submission-batch.dto';

/** Revisions of this entity record who ran which batch over which filter. */
export const BATCH_LOG_ENTITY = 'submission_batch';
/** Every run shares one entity id, so the newest runs are an index walk on `{entity, entityId, createdAt}`. */
export const BATCH_LOG_ID = '00000000-0000-7000-8000-000000000000';

export interface BatchLogEntry {
  action: BatchAction;
  userId: string;
  count: number;
  filter: SubmissionBatchFilterDto;
}

/** Bulk rejudges and rescores in the `revisions` audit log, one row per run. */
@Injectable()
export class BatchLogRepository {
  constructor(
    private readonly revisionLog: RevisionsRepository,
    @InjectModel(Revision.name) private readonly revisions: Model<Revision>,
  ) {}

  append({ action, userId, count, filter }: BatchLogEntry): Promise<void> {
    return this.revisionLog.append({
      entity: BATCH_LOG_ENTITY,
      entityId: BATCH_LOG_ID,
      action,
      userId,
      changes: {
        count: { before: null, after: count },
        filter: { before: null, after: filter },
      },
      comment: '',
    });
  }

  /** Newest first; only `userId`'s runs when given. */
  recent(limit: number, userId?: string): Promise<Revision[]> {
    return this.revisions
      .find({
        entity: BATCH_LOG_ENTITY,
        entityId: BATCH_LOG_ID,
        ...(userId ? { userId } : {}),
      })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .lean<Revision[]>()
      .exec();
  }
}
