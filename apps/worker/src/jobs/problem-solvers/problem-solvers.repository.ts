import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Submission, toUuid, uuidStr } from '@libs/database';
import type { Model } from 'mongoose';

@Injectable()
export class ProblemSolversRepository {
  constructor(
    @InjectModel(Submission.name)
    private readonly submissions: Model<Submission>,
  ) {}

  /** Users with any submission to the problem (`{ problem, user }` index). */
  async userIds(problemId: string): Promise<string[]> {
    return (
      await this.submissions
        .distinct('user', { problem: toUuid(problemId) })
        .exec()
    ).map(uuidStr);
  }
}
