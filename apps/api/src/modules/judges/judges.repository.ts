import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { HydratedDocument, Model } from 'mongoose';
import { Judge } from '@libs/database';

export type JudgeDocument = HydratedDocument<Judge>;
/** A judge without its problem codes (up to 100000) and key hash, with the number of problems. */
export type JudgeListRow = Omit<Judge, 'problems' | 'authKeyHash'> & {
  problemCount: number;
};
export type JudgeChanges = Partial<
  Pick<Judge, 'authKeyHash' | 'isBlocked' | 'isDisabled' | 'description'>
>;

@Injectable()
export class JudgesRepository {
  constructor(@InjectModel(Judge.name) private readonly judges: Model<Judge>) {}

  /** Connected judges and judges that may connect at all (neither blocked nor disabled). */
  async counts(): Promise<{ online: number; total: number }> {
    const usable = { isBlocked: false, isDisabled: false };
    const [online, total] = await Promise.all([
      this.judges.countDocuments({ ...usable, online: true }).exec(),
      this.judges.countDocuments(usable).exec(),
    ]);
    return { online, total };
  }

  /** Every judge by name, or just `name`. */
  list(name?: string): Promise<JudgeListRow[]> {
    return this.judges
      .aggregate<JudgeListRow>([
        ...(name === undefined ? [] : [{ $match: { name } }]),
        { $addFields: { problemCount: { $size: '$problems' } } },
        { $project: { problems: 0, authKeyHash: 0 } },
        { $sort: { name: 1 } },
      ])
      .exec();
  }

  create(
    fields: Pick<Judge, 'name' | 'authKeyHash' | 'description'>,
  ): Promise<JudgeDocument> {
    return this.judges.create(fields);
  }

  /** False for an unknown name. */
  async update(name: string, changes: JudgeChanges): Promise<boolean> {
    const { matchedCount } = await this.judges
      .updateOne({ name }, { $set: changes })
      .exec();
    return matchedCount === 1;
  }

  /** Submit with `judgeId`: the judge is connected, reported the problem's (mirror root's) code and runs the language. */
  async isOnlineFor(
    name: string,
    problemCode: string,
    languageKey: string,
  ): Promise<boolean> {
    return (
      (await this.judges.exists({
        name,
        online: true,
        problems: problemCode,
        'runtimes.language': languageKey,
      })) !== null
    );
  }
}
