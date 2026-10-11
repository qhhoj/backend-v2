import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import { TestGeneration, uuidStr } from '@libs/database';
import type { TestGenerationFailure } from '@libs/database';
import { generationBucket } from '@libs/judging';
import type { GenerationPlan } from '@libs/judging';

/** Rows and their files older than this are removed by the resync, whatever state they ended in (the worker normally cleans up). */
export const GENERATION_RETENTION_MS = 24 * 60 * 60 * 1000;

/** What a judge needs to run a claimed generation. */
export interface ClaimedGeneration {
  id: string;
  bundleSize: number;
  plan: GenerationPlan;
}

/** A running generation's identity, for the upload and bundle RPCs. */
export interface RunningGeneration {
  bundleFileId: unknown;
  resultFileId: unknown;
  maxUploadBytes: number;
}

const runningOn = (id: string, sessionId: string) => ({
  _id: id,
  status: 'running',
  sessionId,
});

/** The bridge's reads and writes of `testGenerations` rows and their GridFS files. Every transition filters on the state it expects, so a late message changes nothing. */
@Injectable()
export class GenerationsRepository {
  private readonly logger = new Logger(GenerationsRepository.name);

  constructor(
    @InjectModel(TestGeneration.name)
    private readonly generations: Model<TestGeneration>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /** Ids of queued rows, among `ids` when given. */
  async queuedIds(ids?: string[]): Promise<string[]> {
    const rows = await this.generations
      .find({ status: 'queued', ...(ids && { _id: { $in: ids } }) }, { _id: 1 })
      .sort({ _id: 1 })
      .lean();
    return rows.map((row) => uuidStr(row._id));
  }

  /** queued -> running on `judge`'s session; null when the row is gone or no longer queued. */
  async claim(
    id: string,
    judge: string,
    sessionId: string,
  ): Promise<ClaimedGeneration | null> {
    const row = await this.generations
      .findOneAndUpdate(
        { _id: id, status: 'queued' },
        {
          $set: { status: 'running', judge, sessionId, startedAt: new Date() },
        },
        { new: true, projection: { plan: 1, bundleSize: 1 } },
      )
      .lean();
    return row
      ? {
          id,
          bundleSize: row.bundleSize,
          plan: row.plan as unknown as GenerationPlan,
        }
      : null;
  }

  /** running -> queued: the session ended while its claim was in flight, the judge never saw the job. */
  async release(id: string, sessionId: string): Promise<void> {
    await this.generations.updateOne(runningOn(id, sessionId), {
      $set: { status: 'queued', judge: null, sessionId: null, startedAt: null },
    });
  }

  /** running -> done; false unless the result upload completed (`resultFileId` set). */
  async complete(id: string, sessionId: string): Promise<boolean> {
    const { modifiedCount } = await this.generations.updateOne(
      { ...runningOn(id, sessionId), resultFileId: { $ne: null } },
      { $set: { status: 'done', endedAt: new Date() } },
    );
    return modifiedCount === 1;
  }

  /** running -> failed; false when the row is not running on that session any more. */
  async fail(
    id: string,
    sessionId: string,
    failure: TestGenerationFailure,
  ): Promise<boolean> {
    const { modifiedCount } = await this.generations.updateOne(
      runningOn(id, sessionId),
      { $set: { status: 'failed', endedAt: new Date(), failure } },
    );
    return modifiedCount === 1;
  }

  /** Ids of running rows (the resync compares them with what live sessions hold). */
  async runningIds(): Promise<string[]> {
    const rows = await this.generations
      .find({ status: 'running' }, { _id: 1 })
      .lean();
    return rows.map((row) => uuidStr(row._id));
  }

  /** running -> failed for a row no live session holds. */
  async failStranded(
    id: string,
    failure: TestGenerationFailure,
  ): Promise<boolean> {
    const { modifiedCount } = await this.generations.updateOne(
      { _id: id, status: 'running' },
      { $set: { status: 'failed', endedAt: new Date(), failure } },
    );
    return modifiedCount === 1;
  }

  /** The row a judge's session may transfer files for. */
  async runningOf(
    id: string,
    sessionId: string,
  ): Promise<RunningGeneration | null> {
    const row = await this.generations
      .findOne(runningOn(id, sessionId), {
        bundleFileId: 1,
        resultFileId: 1,
        plan: 1,
      })
      .lean();
    if (!row) return null;
    const plan = row.plan as unknown as GenerationPlan;
    return {
      bundleFileId: row.bundleFileId,
      resultFileId: row.resultFileId,
      maxUploadBytes: plan.limits.maxUploadBytes,
    };
  }

  /** Records the finished upload; false when a result is already set or the row moved on (the caller deletes its file). */
  async setResult(
    id: string,
    sessionId: string,
    resultFileId: unknown,
  ): Promise<boolean> {
    const { modifiedCount } = await this.generations.updateOne(
      { ...runningOn(id, sessionId), resultFileId: null },
      { $set: { resultFileId } },
    );
    return modifiedCount === 1;
  }

  /** Safety net for rows the worker never cleaned up: ended (or, if never started, created) before `now - GENERATION_RETENTION_MS`. Returns how many went. */
  async deleteExpired(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - GENERATION_RETENTION_MS);
    const old = await this.generations
      .find(
        {
          $or: [
            { endedAt: { $lt: cutoff } },
            { endedAt: null, createdAt: { $lt: cutoff } },
          ],
        },
        { bundleFileId: 1, resultFileId: 1 },
      )
      .lean();
    for (const row of old) {
      await this.deleteFile(row.bundleFileId);
      await this.deleteFile(row.resultFileId);
      await this.generations.deleteOne({ _id: row._id });
    }
    return old.length;
  }

  async deleteFile(fileId: unknown): Promise<void> {
    if (!fileId) return;
    try {
      await generationBucket(this.connection).delete(fileId as never);
    } catch (error) {
      // a file the worker already removed is not an error
      this.logger.debug(`GridFS delete: ${(error as Error).message}`);
    }
  }
}
