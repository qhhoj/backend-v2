import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseModule, newId, Problem } from '@libs/database';
import { startMongo } from '@libs/database/testing';
import type { TestMongo } from '@libs/database/testing';
import { Model } from 'mongoose';
import { ProblemsRepository } from './problems.repository';

describe('ProblemsRepository', () => {
  let replSet: TestMongo,
    testingModule: TestingModule,
    repository: ProblemsRepository,
    problems: Model<Problem>;
  const base = {
    name: 'Sum',
    timeLimit: 1,
    memoryLimit: 262144,
    points: 1000,
    typeIds: [newId()],
    groupId: newId(),
    description: 'body',
    descriptionHtml: '<p>body</p>',
    isPublic: true,
  };

  beforeAll(async () => {
    replSet = await startMongo();
    process.env.MONGO_URL = replSet.getUri('qhhoj');
    testingModule = await Test.createTestingModule({
      imports: [DatabaseModule],
      providers: [ProblemsRepository],
    }).compile();
    repository = testingModule.get(ProblemsRepository);
    problems = testingModule.get(getModelToken(Problem.name));
    await problems.init();
    for (const code of ['banana', 'apple', 'cherry'])
      await repository.create({
        ...base,
        code,
        name: code === 'apple' ? 'Apple' : code === 'cherry' ? 'Cherry' : code,
      });
  });
  afterAll(async () => {
    await testingModule.close();
    await replSet.stop();
  });

  it('lists a page without statement bodies, sorted case-insensitively, with the total', async () => {
    const { items, total } = await repository.list(
      { isPublic: true },
      { name: 1, _id: 1 },
      1,
      2,
    );
    expect(total).toBe(3);
    expect(items.map((problem) => problem.name)).toEqual(['Apple', 'banana']);
    expect(items[0].description).toBeUndefined();
  });
  it('upserts a translation per language', async () => {
    const problem = (await repository.findByCode('apple'))!;
    await repository.upsertTranslation(problem._id, {
      language: 'vi',
      name: 'Táo',
      description: 'a',
      descriptionHtml: '<p>a</p>',
    });
    await repository.upsertTranslation(problem._id, {
      language: 'vi',
      name: 'Quả táo',
      description: 'b',
      descriptionHtml: '<p>b</p>',
    });
    await repository.upsertTranslation(problem._id, {
      language: 'en',
      name: 'Apple',
      description: 'c',
      descriptionHtml: '<p>c</p>',
    });
    const translations = (await repository.findByCode(
      'apple',
    ))!.translations.map(({ language, name }) => ({ language, name }));
    expect(translations).toEqual([
      { language: 'vi', name: 'Quả táo' },
      { language: 'en', name: 'Apple' },
    ]);
  });
  it('keeps one translation per language under concurrent upserts', async () => {
    const problem = (await repository.findByCode('banana'))!;
    await Promise.all(
      ['a', 'b', 'c'].map((suffix) =>
        repository.upsertTranslation(problem._id, {
          language: 'en',
          name: `Banana ${suffix}`,
          description: '',
          descriptionHtml: '',
        }),
      ),
    );
    const translations = (await repository.findByCode('banana'))!.translations;
    expect(translations.map(({ language }) => language)).toEqual(['en']);
  });

  it('picks a random code, retrying once when the set shrank between count and skip', async () => {
    jest.spyOn(repository, 'count').mockResolvedValueOnce(1000);
    jest.spyOn(Math, 'random').mockReturnValueOnce(0.99);
    const code = await repository.randomCode({ isPublic: true });
    jest.restoreAllMocks();
    // Other tests add public problems too: any live public code satisfies the filter.
    expect(code).not.toBeNull();
    expect((await repository.findByCode(code!))?.isPublic).toBe(true);
    expect(await repository.randomCode({ code: 'nothing' })).toBeNull();
  });
});
