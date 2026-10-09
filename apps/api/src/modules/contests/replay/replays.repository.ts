import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { ContestReplayChunk, ContestReplayHead, uuidStr } from '@libs/database';
import type { GhostGap, ReplayEvent } from '@libs/contests';

export interface StoredReplayHead {
  buildId: string;
  builtAt: Date;
  formatVersion: number;
  chunkCount: number;
  ghostChunkCount: number;
  participants: Array<{ participationId: string; userId: string }>;
  problems: Array<{ problemId: string; points: number }>;
  ghosts: Array<{
    label: string;
    caption: string;
    isUnranked: boolean;
    gap: GhostGap | null;
  }>;
}

@Injectable()
export class ReplaysRepository {
  constructor(
    @InjectModel(ContestReplayHead.name)
    private readonly heads: Model<ContestReplayHead>,
    @InjectModel(ContestReplayChunk.name)
    private readonly chunks: Model<ContestReplayChunk>,
  ) {}

  async findHead(contestId: string): Promise<StoredReplayHead | null> {
    const head = await this.heads.findById(contestId).lean().exec();
    return (
      head && {
        buildId: uuidStr(head.buildId),
        builtAt: head.builtAt,
        formatVersion: head.formatVersion,
        chunkCount: head.chunkCount,
        ghostChunkCount: head.ghostChunkCount,
        ghosts: head.ghosts.map(({ label, caption, isUnranked, gap }) => ({
          label,
          caption,
          isUnranked,
          gap,
        })),
        participants: head.participants.map((row) => ({
          participationId: uuidStr(row.participationId),
          userId: uuidStr(row.userId),
        })),
        problems: head.problems.map((row) => ({
          problemId: uuidStr(row.problemId),
          points: row.points,
        })),
      }
    );
  }

  /** Null when the build's chunk is gone (a newer build replaced it). Unique `{contest, buildId, stream, chunk}` index. */
  async findChunk(
    contestId: string,
    buildId: string,
    chunk: number,
  ): Promise<ReplayEvent[] | null> {
    const row = await this.chunks
      .findOne(
        { contest: contestId, buildId, stream: 'real', chunk },
        { events: 1 },
      )
      .lean()
      .exec();
    return row ? (row.events as ReplayEvent[]) : null;
  }

  /** Every event of the build's ghost stream, in chunk order; null when a chunk is gone. */
  async findGhostEvents(
    contestId: string,
    buildId: string,
    chunkCount: number,
  ): Promise<ReplayEvent[] | null> {
    if (chunkCount === 0) return [];
    const rows = await this.chunks
      .find({ contest: contestId, buildId, stream: 'ghost' }, { events: 1 })
      .sort({ chunk: 1 })
      .lean()
      .exec();
    return rows.length === chunkCount
      ? (rows.flatMap((row) => row.events) as ReplayEvent[])
      : null;
  }
}
