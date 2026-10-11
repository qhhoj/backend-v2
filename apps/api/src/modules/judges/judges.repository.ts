import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { HydratedDocument, Model } from 'mongoose';
import { IN_FLIGHT_STATUSES, Judge, Submission } from '@libs/database';

export type JudgeDocument = HydratedDocument<Judge>;
/** A judge without its key hash. */
export type JudgeListRow = Omit<Judge, 'authKeyHash'>;
/** The fields the public runtimes page may show: no key, address, build or notes. */
export type PublicJudgeRow = Pick<
  Judge,
  'name' | 'online' | 'slots' | 'busy' | 'ping' | 'startTime' | 'runtimes'
>;
export type JudgeChanges = Partial<
  Pick<
    Judge,
    'authKeyHash' | 'isBlocked' | 'isDisabled' | 'description' | 'blockReason'
  >
>;

@Injectable()
export class JudgesRepository {
  constructor(
    @InjectModel(Judge.name) private readonly judges: Model<Judge>,
    @InjectModel(Submission.name)
    private readonly submissions: Model<Submission>,
  ) {}

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
        // `problems`: judge documents from before the field was dropped may still hold up to 100000 codes
        { $project: { authKeyHash: 0, problems: 0 } },
        { $sort: { name: 1 } },
      ])
      .exec();
  }

  /** Judges that may connect (neither blocked nor disabled), by name. */
  listPublic(): Promise<PublicJudgeRow[]> {
    return this.judges
      .find(
        { isBlocked: { $ne: true }, isDisabled: { $ne: true } },
        {
          _id: 0,
          name: 1,
          online: 1,
          slots: 1,
          busy: 1,
          ping: 1,
          startTime: 1,
          runtimes: 1,
        },
      )
      .sort({ name: 1 })
      .lean<PublicJudgeRow[]>()
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

  /** Deletes an offline judge; false when it is unknown or online. */
  async deleteOffline(name: string): Promise<boolean> {
    const { deletedCount } = await this.judges
      .deleteOne({ name, online: false })
      .exec();
    return deletedCount === 1;
  }

  /** Renames an offline judge; false when it is unknown or online. Throws a duplicate-key error when `to` is taken. */
  async renameOffline(from: string, to: string): Promise<boolean> {
    const { matchedCount } = await this.judges
      .updateOne({ name: from, online: false }, { $set: { name: to } })
      .exec();
    return matchedCount === 1;
  }

  /** A run handed to the judge before it went offline: its session may still resume it under this name. */
  async hasRunsInFlight(name: string): Promise<boolean> {
    return (
      (await this.submissions.exists({
        status: { $in: [...IN_FLIGHT_STATUSES] },
        judgedOn: name,
      })) !== null
    );
  }

  /** Queued and pending final submissions pinned to `from` wait for `to` instead. */
  async movePins(from: string, to: string): Promise<void> {
    await this.submissions
      .updateMany(
        { status: { $in: ['QU', 'PD'] }, pinnedJudge: from },
        { $set: { pinnedJudge: to } },
      )
      .exec();
  }

  /** Submit with `judgeId`: the judge is connected and runs the language (every judge sees the whole data root). */
  async isOnlineFor(name: string, languageKey: string): Promise<boolean> {
    return (
      (await this.judges.exists({
        name,
        online: true,
        'runtimes.language': languageKey,
      })) !== null
    );
  }
}
