import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { StorageService, TUNING } from '@libs/common';
import { TEST_ENV, TEST_TUNING } from '@libs/common/testing';
import { startMongo } from '@libs/database/testing';
import type { Collection, Document } from 'mongodb';
import type { UUID } from 'mongodb';
import type { Model } from 'mongoose';
import { ContentJobsModule } from '../src/maintenance/content-jobs.module';
import { FETCH } from '../src/maintenance/rehost-hackmd-images/image-downloader';
import { workerTuning } from '../src/worker-tuning';

/** The module the manual content jobs boot, on a database and a media root of its own; `fetch` stands in for the network. */
export async function setupContentJobsTest(
  fetchStub: typeof fetch,
  includeImgur = false,
) {
  const mongo = await startMongo();
  const mediaRoot = mkdtempSync(join(tmpdir(), 'qhhoj-media-'));
  Object.assign(process.env, TEST_ENV, {
    MONGO_URL: mongo.getUri('qhhoj'),
    MEDIA_ROOT: mediaRoot,
    PROBLEM_DATA_ROOT: mkdtempSync(join(tmpdir(), 'qhhoj-problem-data-')),
    PDF_CACHE_ROOT: mkdtempSync(join(tmpdir(), 'qhhoj-pdf-cache-')),
  });
  const module = await Test.createTestingModule({
    imports: [ContentJobsModule.withRehostOptions({ includeImgur })],
  })
    .overrideProvider(TUNING)
    .useValue({ ...workerTuning, ...TEST_TUNING })
    .overrideProvider(FETCH)
    .useValue(fetchStub)
    .compile();
  await module.init();
  return {
    module,
    mediaRoot,
    storage: module.get(StorageService),
    model: <T>(name: string) => module.get<Model<T>>(getModelToken(name)),
    /** The raw collection, for rows the schema would refuse and for reading them back as stored. */
    raw: (name: string) =>
      module.get<Model<unknown>>(getModelToken(name))
        .collection as unknown as Collection<Document & { _id: UUID }>,
    teardown: async () => {
      await module.close();
      await mongo.stop();
      rmSync(mediaRoot, { recursive: true, force: true });
    },
  };
}

export type ContentJobsTest = Awaited<ReturnType<typeof setupContentJobsTest>>;
