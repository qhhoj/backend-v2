import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Problem } from '@libs/database';
import type { Model } from 'mongoose';

@Injectable()
export class PolygonLinksRepository {
  constructor(
    @InjectModel(Problem.name) private readonly problems: Model<Problem>,
  ) {}

  /** Polygon problem id → code of the QHHOJ problem linked to it (deleted problems included: their code and link come back on restore). */
  async codesByPolygonId(polygonIds: number[]): Promise<Map<number, string>> {
    const rows = await this.problems
      .find(
        { 'polygonLink.problemId': { $in: polygonIds } },
        { code: 1, 'polygonLink.problemId': 1 },
      )
      .lean()
      .exec();
    return new Map(
      rows.map((row) => [row.polygonLink!.problemId, row.code] as const),
    );
  }

  /** Writes the switch only while the problem is still linked to the same Polygon problem; false when it is not. */
  async setAutoSync(
    problemId: string,
    polygonId: number,
    autoSync: boolean,
  ): Promise<boolean> {
    const { matchedCount } = await this.problems
      .updateOne(
        { _id: problemId, 'polygonLink.problemId': polygonId },
        { $set: { 'polygonLink.autoSync': autoSync } },
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
