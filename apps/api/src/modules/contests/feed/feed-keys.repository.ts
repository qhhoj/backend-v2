import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import { ContestFeedKey, uuidStr } from '@libs/database';
import type { FeedKeyMode } from '@libs/database';

export interface FeedKeyRecord {
  id: string;
  contest: string;
  keyHash: string;
  mode: FeedKeyMode;
  createdBy: string;
  expiresAt: Date;
  revokedAt: Date | null;
  releasedAt: Date | null;
}

@Injectable()
export class FeedKeysRepository {
  constructor(
    @InjectModel(ContestFeedKey.name)
    private readonly keys: Model<ContestFeedKey>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /** Only the newest key of a contest is ever accepted (`{contest, _id: -1}`). */
  async findNewest(contestId: string): Promise<FeedKeyRecord | null> {
    const [row] = await this.keys
      .find({ contest: contestId })
      .sort({ _id: -1 })
      .limit(1)
      .lean()
      .exec();
    return row ? this.recordOf(row) : null;
  }

  /** One transaction: the earlier keys are revoked and the new one stored. */
  async mint(
    contestId: string,
    fields: Pick<
      ContestFeedKey,
      'keyHash' | 'mode' | 'createdBy' | 'expiresAt'
    >,
    now: Date,
  ): Promise<void> {
    await this.connection.transaction(async (session) => {
      await this.keys.updateMany(
        { contest: contestId, revokedAt: null },
        { $set: { revokedAt: now } },
        { session },
      );
      await this.keys.create([{ contest: contestId, ...fields }], { session });
    });
  }

  async revokeAll(contestId: string, now: Date): Promise<number> {
    const { modifiedCount } = await this.keys
      .updateMany(
        { contest: contestId, revokedAt: null },
        { $set: { revokedAt: now } },
      )
      .exec();
    return modifiedCount;
  }

  /** Every unrevoked key `userId` minted, in any contest: a ban ends them, so an unban does not bring them back. */
  async revokeMintedBy(userId: string, now: Date): Promise<void> {
    await this.keys
      .updateMany(
        { createdBy: userId, revokedAt: null },
        { $set: { revokedAt: now } },
      )
      .exec();
  }

  /** Idempotent: a key released already keeps its first release time. */
  async release(keyId: string, now: Date): Promise<void> {
    await this.keys
      .updateOne(
        { _id: keyId, releasedAt: null },
        { $set: { releasedAt: now } },
      )
      .exec();
  }

  async findById(keyId: string): Promise<FeedKeyRecord | null> {
    const row = await this.keys.findById(keyId).lean().exec();
    return row ? this.recordOf(row) : null;
  }

  private recordOf(row: ContestFeedKey): FeedKeyRecord {
    return {
      id: uuidStr(row._id),
      contest: uuidStr(row.contest),
      keyHash: row.keyHash,
      mode: row.mode,
      createdBy: uuidStr(row.createdBy),
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      releasedAt: row.releasedAt,
    };
  }
}
