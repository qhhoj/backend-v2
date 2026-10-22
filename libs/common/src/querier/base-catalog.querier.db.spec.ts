import { Injectable } from '@nestjs/common';
import { getModelToken, InjectModel } from '@nestjs/mongoose';
import {
  CronExpression,
  ScheduleModule,
  SchedulerRegistry,
} from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseModule, Language } from '@libs/database';
import { startMongo } from '@libs/database/testing';
import type { TestMongo } from '@libs/database/testing';
import type { ChangeStream } from 'mongodb';
import { Model } from 'mongoose';
import { BaseCatalogQuerier } from './base-catalog.querier';

const waitFor = async (check: () => boolean, timeoutMs = 5000) => {
  for (
    const end = Date.now() + timeoutMs;
    !check();
    await new Promise((resolve) => setTimeout(resolve, 20))
  )
    if (Date.now() > end) throw new Error('timeout');
};
const languageNamed = (key: string) => ({
  key,
  name: key,
  commonName: key,
  ace: 'text',
  pygments: 'text',
  extension: 'txt',
});

/** Runs `duringLoad` between reading a snapshot and installing it, and `afterLoad` right after each resync. */
@Injectable()
class WindowedQuerier extends BaseCatalogQuerier<Language> {
  afterLoad: () => Promise<void> = async () => {};
  duringLoad: () => Promise<void> = async () => {};

  constructor(
    @InjectModel(Language.name) model: Model<Language>,
    scheduler: SchedulerRegistry,
  ) {
    super(model, scheduler);
  }

  streamHealthCheckCronExpression() {
    return CronExpression.EVERY_SECOND;
  }

  async resync() {
    await super.resync();
    await this.afterLoad();
  }

  protected async loadAll<Doc>(model: Model<Doc>): Promise<Doc[]> {
    const snapshot = await super.loadAll(model);
    await this.duringLoad();
    return snapshot;
  }
}

describe('BaseCatalogQuerier', () => {
  let replSet: TestMongo,
    testingModule: TestingModule,
    languages: Model<Language>,
    querier: WindowedQuerier,
    watch: jest.SpyInstance<ChangeStream>;

  beforeAll(async () => {
    replSet = await startMongo();
    process.env.MONGO_URL = replSet.getUri('qhhoj');
    testingModule = await Test.createTestingModule({
      imports: [ScheduleModule.forRoot(), DatabaseModule],
      providers: [WindowedQuerier],
    }).compile();
    languages = testingModule.get(getModelToken(Language.name));
    querier = testingModule.get(WindowedQuerier);
    watch = jest.spyOn(languages, 'watch');
    // the first load happens on init: a write right after it must still arrive
    querier.afterLoad = async () => {
      querier.afterLoad = async () => {};
      await languages.create(languageNamed('AT_STARTUP'));
    };
    await testingModule.init();
  });
  afterAll(async () => {
    await testingModule.close();
    await replSet.stop();
  });

  it('keeps a write made between the first load and the stream going live', async () => {
    const inserted = await languages.findOne({ key: 'AT_STARTUP' });
    await waitFor(() => querier.has(inserted!._id));
  });
  it('keeps writes made while the stream was down once it reconnects', async () => {
    await (watch.mock.results[0].value as ChangeStream).close();
    const downtime = await languages.create(languageNamed('WHILE_DOWN'));
    await waitFor(() => querier.has(downtime._id));
    expect(watch.mock.calls.length).toBeGreaterThan(1);
  });
  /** Resyncs with `write` made after the snapshot is read, waiting until the stream has applied it to the live state. */
  const resyncAroundWrite = async (
    write: () => Promise<unknown>,
    applied: () => boolean,
  ) => {
    querier.duringLoad = async () => {
      querier.duringLoad = async () => {};
      await write();
      await waitFor(applied);
    };
    await querier.resync();
  };

  it('keeps a change the stream applied while a resync was loading', async () => {
    const { _id } = await languages.create(languageNamed('BEFORE'));
    await waitFor(() => querier.has(_id));
    await resyncAroundWrite(
      () => languages.updateOne({ _id }, { $set: { name: 'AFTER' } }),
      () => querier.byId(_id)?.name === 'AFTER',
    );
    expect(querier.byId(_id)?.name).toBe('AFTER');
  });
  it('keeps a delete the stream applied while a resync was loading', async () => {
    const { _id } = await languages.create(languageNamed('MID_LOAD'));
    await waitFor(() => querier.has(_id));
    await resyncAroundWrite(
      () => languages.deleteOne({ _id }),
      () => !querier.has(_id),
    );
    expect(querier.has(_id)).toBe(false);
  });
  it('drops a row from memory when its document is deleted', async () => {
    const doomed = await languages.create(languageNamed('DOOMED'));
    await waitFor(() => querier.has(doomed._id));
    await languages.deleteOne({ _id: doomed._id });
    await waitFor(() => !querier.has(doomed._id));
    expect(querier.all().map(({ key }) => key)).not.toContain('DOOMED');
  });
});
