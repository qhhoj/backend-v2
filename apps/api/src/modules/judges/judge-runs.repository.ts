import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import {
  IN_FLIGHT_STATUSES,
  Submission,
  WAITING_STATUSES,
} from '@libs/database';

/** The submissions one judge holds, by name: runs handed to it and submissions pinned to it. */
@Injectable()
export class JudgeRunsRepository {
  constructor(
    @InjectModel(Submission.name)
    private readonly submissions: Model<Submission>,
  ) {}

  /** A run handed to the judge before it went offline: its session may still resume it under this name. */
  async hasRunsInFlight(name: string): Promise<boolean> {
    return (
      (await this.submissions.exists({
        status: { $in: [...IN_FLIGHT_STATUSES] },
        judgedOn: name,
      })) !== null
    );
  }

  /** Waiting submissions pinned to `from` wait for `to` instead. */
  async movePins(from: string, to: string): Promise<void> {
    await this.submissions
      .updateMany(
        { status: { $in: [...WAITING_STATUSES] }, pinnedJudge: from },
        { $set: { pinnedJudge: to } },
      )
      .exec();
  }
}
