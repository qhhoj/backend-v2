import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { ContestOfficialRanking } from '@libs/database';

@Injectable()
export class OfficialRankingsRepository {
  constructor(
    @InjectModel(ContestOfficialRanking.name)
    private readonly rankings: Model<ContestOfficialRanking>,
  ) {}

  findByContest(contestId: string) {
    return this.rankings
      .findById(contestId)
      .lean<ContestOfficialRanking>()
      .exec();
  }

  replace(
    contestId: string,
    fields: Pick<ContestOfficialRanking, 'url' | 'problems' | 'rows'>,
  ) {
    return this.rankings
      .findOneAndReplace(
        { _id: contestId },
        { _id: contestId, ...fields },
        { upsert: true },
      )
      .exec();
  }

  remove(contestId: string) {
    return this.rankings.deleteOne({ _id: contestId }).exec();
  }
}
