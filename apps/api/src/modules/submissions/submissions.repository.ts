import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, HydratedDocument, Model } from 'mongoose';
import {
  newId,
  Submission,
  SubmissionSource,
  UNFINISHED_STATUSES,
} from '@libs/database';

export type SubmissionDocument = HydratedDocument<Submission>;

@Injectable()
export class SubmissionsRepository {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Submission.name)
    private readonly submissions: Model<Submission>,
    @InjectModel(SubmissionSource.name)
    private readonly sources: Model<SubmissionSource>,
  ) {}

  /** The row and its source in one transaction, so the bridge never claims a submission without a source. */
  async create(
    fields: Pick<Submission, 'user' | 'problem' | 'language'>,
    source: string,
  ): Promise<string> {
    const id = newId();
    await this.connection.transaction(async (session) => {
      // `create` with a session takes an array.
      await this.sources.create([{ _id: id, source }], { session });
      await this.submissions.create([{ _id: id, ...fields }], { session });
    });
    return id;
  }

  /** Legacy: rejudged submissions do not count against the user. */
  countUnfinished(userId: string): Promise<number> {
    return this.submissions
      .countDocuments({
        user: userId,
        status: { $in: [...UNFINISHED_STATUSES] },
        rejudgedDate: null,
      })
      .exec();
  }
}
