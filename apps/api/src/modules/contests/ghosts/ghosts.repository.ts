import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import { ghostInputOf } from '@libs/contests';
import type { GhostInput } from '@libs/contests';
import { ContestGhost } from '@libs/database';

@Injectable()
export class GhostsRepository {
  constructor(
    @InjectModel(ContestGhost.name)
    private readonly ghosts: Model<ContestGhost>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /** By label (the order the replay numbers them), through the unique `{contest, label}` index. */
  async findByContest(contestId: string): Promise<GhostInput[]> {
    const rows = await this.ghosts
      .find({ contest: contestId })
      .sort({ label: 1 })
      .lean()
      .exec();
    return rows.map(ghostInputOf);
  }

  /** One transaction: an invalid set leaves the previous one. */
  async replaceAll(
    contestId: string,
    ghosts: readonly GhostInput[],
  ): Promise<void> {
    await this.connection.transaction(async (session) => {
      await this.ghosts.deleteMany({ contest: contestId }, { session });
      await this.ghosts.insertMany(
        ghosts.map((ghost) => ({ contest: contestId, ...ghost })),
        { session },
      );
    });
  }

  async removeAll(contestId: string): Promise<number> {
    const { deletedCount } = await this.ghosts
      .deleteMany({ contest: contestId })
      .exec();
    return deletedCount;
  }
}
