import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { PolygonSyncRun } from '@libs/database';
import type { Model } from 'mongoose';

/** Reads the Polygon sync history the worker writes. */
@Injectable()
export class PolygonSyncRunsRepository {
  constructor(
    @InjectModel(PolygonSyncRun.name)
    private readonly runs: Model<PolygonSyncRun>,
  ) {}

  /** Newest first (UUIDv7 ids sort by time); every problem when `problemId` is absent. */
  async page(
    problemId: string | undefined,
    page: number,
    pageSize: number,
  ): Promise<{ items: PolygonSyncRun[]; total: number }> {
    const filter = problemId === undefined ? {} : { problem: problemId };
    const [items, total] = await Promise.all([
      this.runs
        .find(filter)
        .sort({ _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean<PolygonSyncRun[]>()
        .exec(),
      this.runs.countDocuments(filter).exec(),
    ]);
    return { items, total };
  }
}
