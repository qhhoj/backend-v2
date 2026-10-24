import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  CI,
  Contest,
  ContestAnnouncement,
  ContestGhost,
  ContestParticipation,
  ContestPublicRankingLink,
  ContestSubmission,
  Submission,
  uuidStr,
  User,
} from '@libs/database';
import type { Model } from 'mongoose';

/** The writes of the sync API that the contest modules do not offer: the contestant list by username, and removing an unstarted contest with what belongs to it alone. */
@Injectable()
export class SyncParticipantsRepository {
  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Contest.name) private readonly contests: Model<Contest>,
    @InjectModel(ContestParticipation.name)
    private readonly participations: Model<ContestParticipation>,
    @InjectModel(ContestAnnouncement.name)
    private readonly announcements: Model<ContestAnnouncement>,
    @InjectModel(ContestPublicRankingLink.name)
    private readonly rankingLinks: Model<ContestPublicRankingLink>,
    @InjectModel(ContestGhost.name)
    private readonly ghosts: Model<ContestGhost>,
    @InjectModel(ContestSubmission.name)
    private readonly contestSubmissions: Model<ContestSubmission>,
    @InjectModel(Submission.name)
    private readonly submissions: Model<Submission>,
  ) {}

  /** Active users by username, case-insensitively, with the usernames that matched nobody. */
  async resolveUsernames(
    usernames: string[],
  ): Promise<{ ids: string[]; unknown: string[] }> {
    const rows = await this.users
      .find({ username: { $in: usernames }, isActive: true }, { username: 1 })
      .collation(CI)
      .lean()
      .exec();
    const byName = new Map(
      rows.map((row) => [row.username.toLowerCase(), uuidStr(row._id)]),
    );
    const ids: string[] = [];
    const unknown: string[] = [];
    for (const name of usernames) {
      const id = byName.get(name.toLowerCase());
      if (id) ids.push(id);
      else unknown.push(name);
    }
    return { ids: [...new Set(ids)], unknown };
  }

  /** Replaces the list: users left out lose access. */
  async setContestants(contestId: string, userIds: string[]): Promise<void> {
    await this.contests
      .updateOne({ _id: contestId }, { $set: { privateContestants: userIds } })
      .exec();
  }

  /** Tester submissions are history nobody asked to lose. Both collections are asked: a submission is stamped with its contest before its `contestSubmissions` row is written. */
  async hasSubmissions(contestId: string): Promise<boolean> {
    const [inContest, submitted] = await Promise.all([
      this.contestSubmissions.exists({ contest: contestId }).exec(),
      this.submissions.exists({ contest: contestId }).exec(),
    ]);
    return inContest !== null || submitted !== null;
  }

  /**
   * Deletes the contest only while it is still owned by `clientId`, hidden and not started, in one conditional write, so a person publishing it meanwhile keeps it; then what belongs to it alone (participations, announcements, public ranking link, ghosts). False when the contest no longer qualified.
   */
  async deleteUnstarted(
    contestId: string,
    owner: { clientId: string; now: Date },
  ): Promise<boolean> {
    const { deletedCount } = await this.contests
      .deleteOne({
        _id: contestId,
        managedBy: { $type: 'binData', $eq: owner.clientId },
        isVisible: false,
        startTime: { $gt: owner.now },
      })
      .exec();
    if (deletedCount !== 1) return false;
    const byContest = { contest: contestId };
    await this.participations.deleteMany(byContest).exec();
    await this.announcements.deleteMany(byContest).exec();
    await this.rankingLinks.deleteMany(byContest).exec();
    await this.ghosts.deleteMany(byContest).exec();
    return true;
  }
}
