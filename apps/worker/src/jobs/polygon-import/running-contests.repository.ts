import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Contest, Problem } from '@libs/database';
import type { Model } from 'mongoose';

/** An automatic sync waits while a contest that uses the problem runs: its statement and tests must not change under the contestants. */
@Injectable()
export class RunningContestsRepository {
  constructor(
    @InjectModel(Problem.name) private readonly problems: Model<Problem>,
    @InjectModel(Contest.name) private readonly contests: Model<Contest>,
  ) {}

  /** The latest end of the running contests that use the problem; null when none runs. */
  async runningUntil(problemCode: string, now: Date): Promise<Date | null> {
    const problem = await this.problems
      .findOne({ code: problemCode }, { _id: 1 })
      .lean()
      .exec();
    if (!problem) return null;
    const mirrors = await this.problems
      .find({ mirrorRoot: problem._id }, { _id: 1 })
      .lean()
      .exec();
    const judgedWithIt = [problem._id, ...mirrors.map((mirror) => mirror._id)];
    const contest = await this.contests
      .findOne(
        {
          'problems.problem': { $in: judgedWithIt },
          startTime: { $lte: now },
          endTime: { $gt: now },
        },
        { endTime: 1 },
      )
      .sort({ endTime: -1 })
      .lean()
      .exec();
    return contest?.endTime ?? null;
  }
}
