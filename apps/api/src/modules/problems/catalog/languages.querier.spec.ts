import { getModelToken } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseModule, Language } from '@libs/database';
import { startMongo } from '@libs/database/testing';
import { Model } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { LanguagesQuerier } from './languages.querier';

const waitFor = async (check: () => boolean, timeoutMs = 5000) => {
  for (
    const end = Date.now() + timeoutMs;
    !check();
    await new Promise((resolve) => setTimeout(resolve, 50))
  )
    if (Date.now() > end) throw new Error('timeout');
};
const cpp = {
  key: 'CPP17',
  name: 'C++17',
  commonName: 'C++',
  ace: 'c_cpp',
  pygments: 'cpp',
  extension: 'cpp',
  includeInProblem: true,
};

describe('LanguagesQuerier', () => {
  let replSet: MongoMemoryReplSet,
    testingModule: TestingModule,
    languages: Model<Language>,
    querier: LanguagesQuerier;
  let cppId: string;

  beforeAll(async () => {
    replSet = await startMongo();
    process.env.MONGO_URL = replSet.getUri('qhhoj');
    testingModule = await Test.createTestingModule({
      imports: [ScheduleModule.forRoot(), DatabaseModule],
      providers: [LanguagesQuerier],
    }).compile();
    languages = testingModule.get(getModelToken(Language.name));
    cppId = (await languages.create(cpp))._id;
    await testingModule.init();
    querier = testingModule.get(LanguagesQuerier);
  });
  afterAll(async () => {
    await testingModule.close();
    await replSet.stop();
  });

  it('loads existing languages on init with string ids', () => {
    expect(querier.byId(cppId)).toMatchObject({
      _id: cppId,
      key: 'CPP17',
      includeInProblem: true,
    });
    expect(querier.byId('00000000-0000-7000-8000-000000000000')).toBeNull();
    expect(
      querier.includedInProblems().map((language) => language.key),
    ).toEqual(['CPP17']);
  });
  it('applies inserts and updates from the change stream', async () => {
    const python = await languages.create({
      key: 'PY3',
      name: 'Python 3',
      commonName: 'Python',
      ace: 'python',
      pygments: 'python3',
      extension: 'py',
    });
    await waitFor(() => querier.has(python._id));
    await languages.updateOne({ _id: python._id }, { includeInProblem: true });
    await waitFor(() => querier.byId(python._id)?.includeInProblem === true);
    expect(
      querier
        .byIds([cppId, python._id, '00000000-0000-7000-8000-000000000000'])
        .map((language) => language.key),
    ).toEqual(['CPP17', 'PY3']);
  });
  it('recovers after resync', async () => {
    await languages.collection.updateOne(
      { key: 'CPP17' },
      { $set: { includeInProblem: false } },
    );
    await querier.resync();
    expect(querier.byId(cppId)?.includeInProblem).toBe(false);
  });
});
