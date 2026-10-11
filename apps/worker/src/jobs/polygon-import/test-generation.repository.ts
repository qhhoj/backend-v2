import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { createWriteStream } from 'node:fs';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Judge, newId, TestGeneration } from '@libs/database';
import type {
  TestGenerationFailure,
  TestGenerationStatus,
} from '@libs/database';
import { featureOf, generationBucket } from '@libs/judging';
import type { GenerationFeature, GenerationPlan } from '@libs/judging';
import type { Connection, Model } from 'mongoose';

/** What the waiter reads of a row on each poll. */
export interface GenerationState {
  status: TestGenerationStatus;
  failure: TestGenerationFailure | null;
}

/** The `test_generations` rows and their GridFS files (bundle in, result out) that one test generation owns. */
@Injectable()
export class TestGenerationRepository {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(TestGeneration.name)
    private readonly generations: Model<TestGeneration>,
    @InjectModel(Judge.name) private readonly judges: Model<Judge>,
  ) {}

  /** Stores the bundle, then inserts the queued row; a failed insert takes the bundle back. */
  async enqueue(plan: GenerationPlan, bundle: Readable): Promise<string> {
    const upload = generationBucket(this.connection).openUploadStream(
      'bundle.zip',
    );
    await pipeline(bundle, upload);
    const id = newId();
    try {
      await this.generations.create({
        _id: id,
        status: 'queued',
        plan,
        feature: featureOf(plan),
        bundleFileId: upload.id,
        bundleSize: upload.length,
      });
    } catch (error) {
      await generationBucket(this.connection).delete(upload.id);
      throw error;
    }
    return id;
  }

  async stateOf(id: string): Promise<GenerationState | null> {
    return this.generations
      .findById(id, { status: 1, failure: 1 })
      .lean<GenerationState>()
      .exec();
  }

  /** An enabled judge that is online and advertises `feature`. */
  async hasCapableJudge(feature: GenerationFeature): Promise<boolean> {
    return Boolean(
      await this.judges.exists({
        online: true,
        isBlocked: false,
        isDisabled: false,
        features: feature,
      }),
    );
  }

  /** Writes the result zip of a `done` row to `destination`. */
  async saveResult(id: string, destination: string): Promise<void> {
    const row = await this.generations
      .findById(id, { resultFileId: 1 })
      .lean<{ resultFileId: unknown }>()
      .exec();
    if (!row?.resultFileId)
      throw new Error(`Test generation ${id} is done but has no result file`);
    await pipeline(
      generationBucket(this.connection).openDownloadStream(
        row.resultFileId as never,
      ),
      createWriteStream(destination),
    );
  }

  /** Removes the row and both GridFS files; safe to call for a row that is already gone. */
  async remove(id: string): Promise<void> {
    const row = await this.generations
      .findByIdAndDelete(id, {
        projection: { bundleFileId: 1, resultFileId: 1 },
      })
      .lean<{ bundleFileId: unknown; resultFileId: unknown }>()
      .exec();
    const bucket = generationBucket(this.connection);
    for (const fileId of [row?.bundleFileId, row?.resultFileId])
      if (fileId) await bucket.delete(fileId as never).catch(() => undefined);
  }
}
