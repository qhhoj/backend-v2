import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Problem } from '@libs/database';
import type { Model } from 'mongoose';

@Injectable()
export class ProblemPackageRepository {
  constructor(
    @InjectModel(Problem.name) private readonly problems: Model<Problem>,
  ) {}

  /** The live problem with its test data (`select: false` otherwise); a deleted problem is not packaged. */
  findByCode(code: string): Promise<Problem | null> {
    return this.problems
      .findOne({ code, deletedAt: null })
      .select('+data')
      .lean<Problem>()
      .exec();
  }
}
