import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Problem } from '@libs/database';
import type { Model } from 'mongoose';

@Injectable()
export class PolygonLinksRepository {
  constructor(
    @InjectModel(Problem.name) private readonly problems: Model<Problem>,
  ) {}

  /** The problem linked to a Polygon problem, or null. A problem in its deletion grace period still holds its link (a restore brings it back) and `deletedAt` tells the caller; a purged tombstone never does. At most one exists: the index on the link is unique. */
  linkedTo(polygonId: number): Promise<Problem | null> {
    return this.problems
      .findOne({ 'polygonLink.problemId': polygonId, purgedAt: null })
      .lean<Problem>()
      .exec();
  }

  /** Writes the switch only while the problem is still linked to the same Polygon problem; false when it is not. `runAs` becomes the user auto-sync runs as (`linkedBy`). */
  async setAutoSync(
    problemId: string,
    polygonId: number,
    autoSync: boolean,
    runAs?: string,
  ): Promise<boolean> {
    const { matchedCount } = await this.problems
      .updateOne(
        { _id: problemId, 'polygonLink.problemId': polygonId },
        {
          $set: {
            'polygonLink.autoSync': autoSync,
            ...(runAs && { 'polygonLink.linkedBy': runAs }),
          },
        },
      )
      .exec();
    return matchedCount === 1;
  }

  async unlink(problemId: string, polygonId: number): Promise<boolean> {
    const { matchedCount } = await this.problems
      .updateOne(
        { _id: problemId, 'polygonLink.problemId': polygonId },
        { $set: { polygonLink: null } },
      )
      .exec();
    return matchedCount === 1;
  }
}
