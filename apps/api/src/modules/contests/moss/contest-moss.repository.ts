import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { ContestMoss, uuidStr } from '@libs/database';

export interface MossRow {
  problemId: string;
  language: string;
  submissionCount: number;
  url: string | null;
}

@Injectable()
export class ContestMossRepository {
  constructor(
    @InjectModel(ContestMoss.name)
    private readonly mossRows: Model<ContestMoss>,
  ) {}

  async findByContest(contestId: string): Promise<MossRow[]> {
    const rows = await this.mossRows.find({ contest: contestId }).lean().exec();
    return rows.map((row) => ({
      problemId: uuidStr(row.problem),
      language: row.language,
      submissionCount: row.submissionCount,
      url: row.url,
    }));
  }

  async deleteByContest(contestId: string): Promise<void> {
    await this.mossRows.deleteMany({ contest: contestId }).exec();
  }
}
