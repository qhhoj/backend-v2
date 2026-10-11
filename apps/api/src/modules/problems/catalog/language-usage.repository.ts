import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Problem, Submission, uuidStr } from '@libs/database';

interface IdCount {
  _id: unknown;
  count: number;
}

const byLanguageId = (rows: IdCount[]): Map<string, number> =>
  new Map(rows.map(({ _id, count }) => [uuidStr(_id), count]));

/** Counts for the languages admin: how many live problems allow each language and how much it is submitted in. */
@Injectable()
export class LanguageUsageRepository {
  constructor(
    @InjectModel(Problem.name) private readonly problems: Model<Problem>,
    @InjectModel(Submission.name)
    private readonly submissions: Model<Submission>,
  ) {}

  /** Live problems allowing each language id. */
  async problemsPerLanguage(): Promise<Map<string, number>> {
    return byLanguageId(
      await this.problems
        .aggregate<IdCount>([
          { $match: { deletedAt: null } },
          { $unwind: '$allowedLanguages' },
          { $group: { _id: '$allowedLanguages', count: { $sum: 1 } } },
        ])
        .exec(),
    );
  }

  /** Submissions per language id since `since`, through the `date` index. */
  async submissionsPerLanguageSince(since: Date): Promise<Map<string, number>> {
    return byLanguageId(
      await this.submissions
        .aggregate<IdCount>([
          { $match: { date: { $gte: since } } },
          { $group: { _id: '$language', count: { $sum: 1 } } },
        ])
        .exec(),
    );
  }
}
