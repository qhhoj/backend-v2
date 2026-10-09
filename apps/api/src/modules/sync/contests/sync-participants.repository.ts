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

  /** Tester submissions are history nobody asked to lose (preflight M16). */
  async hasSubmissions(contestId: string): Promise<boolean> {
    return (
      (await this.contestSubmissions.exists({ contest: contestId }).exec()) !==
      null
    );
  }

  /** The contest and what belongs to it alone (participations, announcements, public ranking link, ghosts); only for a hidden contest that has not started and has no submissions. The contest goes last, so a failure leaves it in place to retry. */
  async deleteUnstarted(contestId: string): Promise<void> {
    const byContest = { contest: contestId };
    await this.participations.deleteMany(byContest).exec();
    await this.announcements.deleteMany(byContest).exec();
    await this.rankingLinks.deleteMany(byContest).exec();
    await this.ghosts.deleteMany(byContest).exec();
    await this.contests.deleteOne({ _id: contestId }).exec();
  }
}
