import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { isDuplicateKey } from '@libs/common';
import { LIVE } from '@libs/contests';
import type { ProblemCell } from '@libs/contests';
import { ContestBalloon, ContestParticipation, uuidStr } from '@libs/database';

export interface LiveBalloonRow {
  participationId: string;
  userId: string;
  cells: Record<string, ProblemCell>;
}
export interface DeliveryRecord {
  participation: string;
  problem: string;
  deliveredAt: Date;
  deliveredBy: string;
}

@Injectable()
export class BalloonsRepository {
  constructor(
    @InjectModel(ContestParticipation.name)
    private readonly participations: Model<ContestParticipation>,
    @InjectModel(ContestBalloon.name)
    private readonly balloons: Model<ContestBalloon>,
  ) {}

  /** Live, not disqualified, with the live cells (never the frozen ones: a balloon is delivered when the problem is solved; the reader-facing numbers are hidden in the service during a freeze). */
  async liveRows(contestId: string): Promise<LiveBalloonRow[]> {
    const rows = await this.participations
      .find(
        { contest: contestId, virtual: LIVE, isDisqualified: false },
        { user: 1, formatData: 1 },
      )
      .sort({ _id: 1 })
      .lean()
      .exec();
    return rows.map((row) => ({
      participationId: uuidStr(row._id),
      userId: uuidStr(row.user),
      cells: row.formatData ?? {},
    }));
  }

  /** Any participation row (live, virtual or spectating) makes a user a contestant. */
  async hasParticipation(contestId: string, userId: string): Promise<boolean> {
    return (
      (await this.participations.exists({
        contest: contestId,
        user: userId,
      })) !== null
    );
  }

  async deliveries(contestId: string): Promise<DeliveryRecord[]> {
    const rows = await this.balloons.find({ contest: contestId }).lean().exec();
    return rows.map((row) => ({
      participation: uuidStr(row.participation),
      problem: uuidStr(row.problem),
      deliveredAt: row.deliveredAt,
      deliveredBy: uuidStr(row.deliveredBy),
    }));
  }

  /** False when the unique `{contest, participation, problem}` index already holds it. */
  async markDelivered(
    contestId: string,
    delivery: DeliveryRecord,
  ): Promise<boolean> {
    try {
      await this.balloons.create({ contest: contestId, ...delivery });
      return true;
    } catch (error) {
      if (isDuplicateKey(error)) return false;
      throw error;
    }
  }

  async unmarkDelivered(
    contestId: string,
    participationId: string,
    problemId: string,
  ): Promise<boolean> {
    const { deletedCount } = await this.balloons
      .deleteOne({
        contest: contestId,
        participation: participationId,
        problem: problemId,
      })
      .exec();
    return deletedCount === 1;
  }
}
