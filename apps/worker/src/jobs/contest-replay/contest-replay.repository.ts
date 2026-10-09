import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { ghostInputOf, LIVE } from '@libs/contests';
import type { GhostInput, ReplayEvent } from '@libs/contests';
import {
  ContestGhost,
  ContestParticipation,
  ContestReplayChunk,
  ContestReplayHead,
} from '@libs/database';
import type {
  ReplayGhost,
  ReplayParticipant,
  ReplayProblem,
} from '@libs/database';

export type ReplayParticipation = Pick<
  ContestParticipation,
  '_id' | 'user' | 'realStart' | 'virtual' | 'isRegistered'
>;

export interface ReplayHeadInput {
  _id: string;
  buildId: string;
  builtAt: Date;
  formatVersion: number;
  chunkCount: number;
  ghostChunkCount: number;
  participants: ReplayParticipant[];
  problems: ReplayProblem[];
  ghosts: ReplayGhost[];
}

@Injectable()
export class ContestReplayRepository {
  constructor(
    @InjectModel(ContestParticipation.name)
    private readonly participations: Model<ContestParticipation>,
    @InjectModel(ContestGhost.name)
    private readonly ghosts: Model<ContestGhost>,
    @InjectModel(ContestReplayHead.name)
    private readonly heads: Model<ContestReplayHead>,
    @InjectModel(ContestReplayChunk.name)
    private readonly chunks: Model<ContestReplayChunk>,
  ) {}

  /** Live, not disqualified (registrations included, like the live board), oldest id first so participant indexes are stable. Through `{contest, virtual}`. */
  liveParticipations(contestId: string): Promise<ReplayParticipation[]> {
    return this.participations
      .find(
        { contest: contestId, virtual: LIVE, isDisqualified: false },
        { user: 1, realStart: 1, virtual: 1, isRegistered: 1 },
      )
      .sort({ _id: 1 })
      .lean<ReplayParticipation[]>()
      .exec();
  }

  /** Through the unique `{contest, label}` index. */
  async ghostsOf(contestId: string): Promise<GhostInput[]> {
    const rows = await this.ghosts
      .find({ contest: contestId })
      .sort({ label: 1 })
      .lean()
      .exec();
    return rows.map(ghostInputOf);
  }

  async insertChunks(
    contestId: string,
    buildId: string,
    stream: 'real' | 'ghost',
    chunks: readonly ReplayEvent[][],
  ): Promise<void> {
    if (!chunks.length) return;
    await this.chunks.insertMany(
      chunks.map((events, chunk) => ({
        contest: contestId,
        buildId,
        stream,
        chunk,
        events,
      })),
    );
  }

  /** The last write of a build: readers switch to the new chunks here. */
  async replaceHead(head: ReplayHeadInput): Promise<void> {
    await this.heads
      .findOneAndReplace({ _id: head._id }, head, { upsert: true })
      .exec();
  }

  async deleteOtherBuilds(
    contestId: string,
    keepBuildId: string,
  ): Promise<void> {
    await this.chunks
      .deleteMany({ contest: contestId, buildId: { $ne: keepBuildId } })
      .exec();
  }

  async removeAll(contestId: string): Promise<void> {
    await this.heads.deleteOne({ _id: contestId }).exec();
    await this.chunks.deleteMany({ contest: contestId }).exec();
  }
}
