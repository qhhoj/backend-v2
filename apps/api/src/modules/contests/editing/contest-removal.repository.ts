import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { SPECTATE } from '@libs/contests';
import {
  Contest,
  ContestAnnouncement,
  ContestBalloon,
  ContestFeedKey,
  ContestGhost,
  ContestOfficialRanking,
  ContestParticipation,
  ContestPublicRankingLink,
  ContestReplayChunk,
  ContestReplayHead,
  ContestSubmission,
  Rating,
  SimilarityPair,
  SimilarityRun,
  Submission,
  UNFINISHED_STATUSES,
  User,
} from '@libs/database';

/** A contest's own collections, deleted with it (legacy cascades; submissions are kept, like legacy `SET_NULL`). */
@Injectable()
export class ContestRemovalRepository {
  constructor(
    @InjectModel(Contest.name) private readonly contests: Model<Contest>,
    @InjectModel(ContestParticipation.name)
    private readonly participations: Model<ContestParticipation>,
    @InjectModel(ContestSubmission.name)
    private readonly contestSubmissions: Model<ContestSubmission>,
    @InjectModel(Submission.name)
    private readonly submissions: Model<Submission>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Rating.name) private readonly ratings: Model<Rating>,
    @InjectModel(ContestAnnouncement.name)
    private readonly announcements: Model<ContestAnnouncement>,
    @InjectModel(ContestPublicRankingLink.name)
    private readonly rankingLinks: Model<ContestPublicRankingLink>,
    @InjectModel(ContestGhost.name)
    private readonly ghosts: Model<ContestGhost>,
    @InjectModel(ContestBalloon.name)
    private readonly balloons: Model<ContestBalloon>,
    @InjectModel(ContestFeedKey.name)
    private readonly feedKeys: Model<ContestFeedKey>,
    @InjectModel(ContestReplayChunk.name)
    private readonly replayChunks: Model<ContestReplayChunk>,
    @InjectModel(ContestReplayHead.name)
    private readonly replayHeads: Model<ContestReplayHead>,
    @InjectModel(ContestOfficialRanking.name)
    private readonly officialRankings: Model<ContestOfficialRanking>,
    @InjectModel(SimilarityRun.name)
    private readonly similarityRuns: Model<SimilarityRun>,
    @InjectModel(SimilarityPair.name)
    private readonly similarityPairs: Model<SimilarityPair>,
  ) {}

  /** Through the `{contest, user}` index. */
  async hasRatings(contestId: string): Promise<boolean> {
    return (await this.ratings.exists({ contest: contestId }).exec()) !== null;
  }

  /** Live or virtual rows (spectator rows hold no results), through the `{contest, virtual}` index. */
  async hasParticipations(contestId: string): Promise<boolean> {
    return (
      (await this.participations
        .exists({ contest: contestId, virtual: { $ne: SPECTATE } })
        .exec()) !== null
    );
  }

  /** Queued, judging or pending final submissions (`{status, contest, _id}` index): their results would land on a deleted contest. */
  async hasUnjudgedSubmissions(contestId: string): Promise<boolean> {
    return (
      (await this.submissions
        .exists({
          contest: contestId,
          status: { $in: [...UNFINISHED_STATUSES, 'PD'] },
        })
        .exec()) !== null
    );
  }

  /** One conditional write: a contest made visible meanwhile is kept. */
  async deleteHidden(contestId: string): Promise<boolean> {
    const { deletedCount } = await this.contests
      .deleteOne({ _id: contestId, isVisible: false })
      .exec();
    return deletedCount === 1;
  }

  /** After the contest row is gone: current-contest pointers, then every row keyed by the contest; its submissions leave the contest. */
  async deleteOwnedRows(contestId: string): Promise<void> {
    const byContest = { contest: contestId };
    await this.clearCurrentPointers(contestId);
    await this.deleteSimilarityRuns(contestId);
    await Promise.all([
      this.participations.deleteMany(byContest).exec(),
      this.contestSubmissions.deleteMany(byContest).exec(),
      this.announcements.deleteMany(byContest).exec(),
      this.rankingLinks.deleteMany(byContest).exec(),
      this.ghosts.deleteMany(byContest).exec(),
      this.balloons.deleteMany(byContest).exec(),
      this.feedKeys.deleteMany(byContest).exec(),
      this.replayChunks.deleteMany(byContest).exec(),
      this.replayHeads.deleteOne({ _id: contestId }).exec(),
      this.officialRankings.deleteOne({ _id: contestId }).exec(),
    ]);
    await this.submissions
      .updateMany(byContest, { $set: { contest: null } })
      .exec();
  }

  /** No index on `users.currentParticipation`: skipped when the contest has no rows. */
  private async clearCurrentPointers(contestId: string): Promise<void> {
    const ids = await this.participations
      .distinct('_id', { contest: contestId })
      .exec();
    if (!ids.length) return;
    await this.users
      .updateMany(
        { currentParticipation: { $in: ids } },
        { $set: { currentParticipation: null } },
      )
      .exec();
  }

  private async deleteSimilarityRuns(contestId: string): Promise<void> {
    const runIds = await this.similarityRuns
      .distinct('_id', { contest: contestId })
      .exec();
    if (!runIds.length) return;
    await this.similarityPairs.deleteMany({ run: { $in: runIds } }).exec();
    await this.similarityRuns.deleteMany({ _id: { $in: runIds } }).exec();
  }
}
