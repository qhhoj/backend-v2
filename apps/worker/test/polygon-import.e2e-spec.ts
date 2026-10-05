import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { getModelToken } from '@nestjs/mongoose';
import type { Job } from 'bullmq';
import type { Model } from 'mongoose';
import { parse } from 'yaml';
import { Group, newId, Problem, Revision } from '@libs/database';
import { listZipEntries } from '@libs/problems';
import type { PolygonImportJob } from '@libs/problems';
import { PNG } from '@libs/problems/testing';
import { PandocService } from '../src/jobs/polygon-import/pandoc.service';
import { PolygonImportProcessor } from '../src/jobs/polygon-import/polygon-import.processor';
import { PolygonImportRepository } from '../src/jobs/polygon-import/polygon-import.repository';
import { buildPolygonPackage, properties } from './polygon-fixtures';
import type { PolygonFixture } from './polygon-fixtures';
import { setupWorkerTest } from './setup';
import type { WorkerTest } from './setup';

const fakePandoc = {
  assertAvailable: () => Promise.resolve(),
  texToMarkdown: (tex: string) => Promise.resolve(tex),
};

describe('PolygonImportProcessor', () => {
  let worker: WorkerTest;
  let processor: PolygonImportProcessor;
  let revisions: Model<Revision>;
  let groupId: string, otherGroupId: string, typeId: string;
  let requesterId: string, writerId: string, cppId: string;
  const fixture: PolygonFixture = {
    tests: [
      { input: '1 2', answer: '3', group: 'g1' },
      { input: '2 3', answer: '5', group: 'g1' },
      { input: '0 0', answer: '0', points: 40 },
    ],
    groups: [{ name: 'g1', points: 60, policy: 'complete-group' }],
    checker: { path: 'files/check.cpp' },
    statements: [
      {
        language: 'english',
        name: 'Sum',
        properties: properties({
          legend: 'Add $a$ and $b$. ![image](fig.png)',
          tutorial: 'Add.',
        }),
        images: { 'fig.png': PNG },
      },
      {
        language: 'vietnamese',
        name: 'Tổng',
        properties: properties({ legend: 'Cộng.' }),
      },
    ],
    solution: {
      path: 'solutions/main.cpp',
      type: 'cpp.g++17',
      code: 'int main() {}',
    },
  };
  const stage = (name: string, pkg: Buffer) => {
    mkdirSync(join(worker.problemDataRoot, '.imports'), { recursive: true });
    const path = join(worker.problemDataRoot, '.imports', `${name}.zip`);
    writeFileSync(path, pkg);
    return path;
  };
  const job = (
    overrides: Partial<PolygonImportJob>,
    pkg = buildPolygonPackage(fixture),
  ): Job<PolygonImportJob> =>
    ({
      data: {
        packagePath: stage(newId(), pkg),
        requesterId,
        code: 'sum',
        mode: 'create',
        authors: [requesterId],
        curators: [],
        groupId,
        typeIds: [typeId],
        allowedLanguages: [],
        points: 800,
        isFullMarkup: false,
        mainStatementLanguage: 'english',
        statementLanguages: { vietnamese: 'vi' },
        tutorialLanguage: null,
        ignoreZeroPointBatches: false,
        ignoreZeroPointCases: false,
        appendMainSolution: true,
        ...overrides,
      },
    }) as Job<PolygonImportJob>;
  /** An update that gives nothing but the package. */
  const bareUpdate = (
    overrides: Partial<PolygonImportJob> = {},
    pkg = buildPolygonPackage(fixture),
  ) =>
    job(
      {
        mode: 'update',
        authors: undefined,
        curators: undefined,
        groupId: undefined,
        typeIds: undefined,
        allowedLanguages: undefined,
        points: undefined,
        ...overrides,
      },
      pkg,
    );
  const imageCount = () => {
    const directory = join(worker.mediaRoot, 'images');
    return existsSync(directory) ? readdirSync(directory).length : 0;
  };
  const dataDirectory = (code: string) => join(worker.problemDataRoot, code);

  beforeAll(async () => {
    worker = await setupWorkerTest({
      overrides: [{ provide: PandocService, useValue: fakePandoc }],
    });
    processor = worker.module.get(PolygonImportProcessor);
    revisions = worker.module.get<Model<Revision>>(
      getModelToken(Revision.name),
    );
    groupId = (
      await worker.problemGroups.create({
        name: 'Uncategorized',
        fullName: 'Uncategorized',
      })
    )._id;
    otherGroupId = (
      await worker.problemGroups.create({ name: 'Other', fullName: 'Other' })
    )._id;
    typeId = (
      await worker.problemTypes.create({
        name: 'uncategorized',
        fullName: 'Uncategorized',
      })
    )._id;
    cppId = (
      await worker.languages.create({
        key: 'CPP17',
        name: 'C++17',
        commonName: 'C++',
        ace: 'c_cpp',
        pygments: 'cpp',
        extension: 'cpp',
        includeInProblem: true,
      })
    )._id;
    await worker.languages.create({
      key: 'TEXT',
      name: 'Text',
      commonName: 'Text',
      ace: 'text',
      pygments: 'text',
      extension: 'txt',
      includeInProblem: false,
    });
    requesterId = (
      await worker.users.create({ username: 'setter', password: '!' })
    )._id;
    writerId = (
      await worker.users.create({
        username: 'writer',
        password: '!',
        isActive: true,
        permissions: ['judge.problem_full_markup'],
      })
    )._id;
  });
  afterAll(() => worker.teardown());

  it('creates the problem, translations, editorial, data, files and init.yml in one go', async () => {
    mkdirSync(worker.pdfCacheRoot, { recursive: true });
    writeFileSync(join(worker.pdfCacheRoot, 'sum.en.pdf'), 'stale');
    const created = job({});
    const imagesBefore = imageCount();
    const result = await processor.process(created);
    const problem = await worker.problems
      .findOne({ code: 'sum' })
      .select('+data');
    expect(result).toEqual({ problemId: problem!._id, code: 'sum' });
    expect(problem).toMatchObject({
      name: 'Sum',
      timeLimit: 1,
      memoryLimit: 262144,
      partial: true,
      points: 800,
      authors: [requesterId],
      dataVersion: 1,
    });
    expect(problem!.description).toContain('## Input');
    expect(problem!.description).toMatch(
      /!\[image\]\(\/media\/images\/[0-9a-f-]{36}\.png\)/,
    );
    expect(problem!.descriptionHtml).toContain('<img');
    expect(problem!.translations).toEqual([
      expect.objectContaining({ language: 'vi', name: 'Tổng' }),
    ]);
    expect(problem!.translations[0].descriptionHtml).toContain('Cộng');
    expect(problem!.solution).toMatchObject({ isPublic: false });
    expect(problem!.solution!.content).toContain(
      '<blockquote class="spoiler">\n```cpp\nint main() {}',
    );
    expect(problem!.solution!.contentHtml).toContain('int main()');
    expect(problem!.data).toMatchObject({
      archive: 'tests.zip',
      checker: 'bridged',
      customChecker: 'checker.cpp',
      grader: 'standard',
      feedback: '',
    });
    expect(problem!.data!.cases.map((row) => row.type)).toEqual([
      'S',
      'C',
      'C',
      'E',
      'C',
    ]);
    const directory = dataDirectory('sum');
    expect(readdirSync(directory).sort()).toEqual([
      'checker.cpp',
      'init.yml',
      'tests.zip',
    ]);
    expect(await listZipEntries(join(directory, 'tests.zip'))).toEqual([
      '01.inp',
      '01.out',
      '02.inp',
      '02.out',
      '03.inp',
      '03.out',
    ]);
    expect(
      parse(readFileSync(join(directory, 'init.yml'), 'utf8')),
    ).toMatchObject({
      archive: 'tests.zip',
      checker: {
        name: 'bridged',
        args: { files: 'checker.cpp', lang: 'CPP17', type: 'testlib' },
      },
      test_cases: [
        {
          points: 60,
          batched: [
            { in: '01.inp', out: '01.out' },
            { in: '02.inp', out: '02.out' },
          ],
        },
        { in: '03.inp', out: '03.out', points: 40 },
      ],
    });
    expect(imageCount()).toBe(imagesBefore + 1);
    expect(existsSync(created.data.packagePath)).toBe(false);
    expect(existsSync(join(worker.pdfCacheRoot, 'sum.en.pdf'))).toBe(false);
  });

  it('records the import as a revision with the configuration and a case summary, never rendered HTML or full case rows', async () => {
    const problem = await worker.problems.findOne({ code: 'sum' });
    const revision = await revisions.findOne({
      entityId: problem!._id,
      action: 'import',
    });
    expect(revision!.userId).toBe(requesterId);
    const changes = JSON.stringify(revision!.changes);
    expect(changes).not.toContain('descriptionHtml');
    expect(changes).not.toContain('contentHtml');
    expect(revision!.changes.name).toEqual({ before: null, after: 'Sum' });
    expect(revision!.changes.checker).toEqual({
      before: 'standard',
      after: 'bridged',
    });
    expect(revision!.changes.cases).toMatchObject({ after: { count: 5 } });
  });

  it('creates with the catalog defaults when none are given', async () => {
    await processor.process(
      job({
        code: 'plain',
        authors: undefined,
        groupId: undefined,
        typeIds: undefined,
        allowedLanguages: undefined,
        points: undefined,
      }),
    );
    expect(await worker.problems.findOne({ code: 'plain' })).toMatchObject({
      points: 800,
      groupId,
      typeIds: [typeId],
      allowedLanguages: [cppId],
      authors: [],
    });
  });

  it('updates in place, keeping what is not given, and replaces statement, translations and data', async () => {
    const before = await worker.problems.findOne({ code: 'sum' });
    const imagesBefore = imageCount();
    await processor.process(
      bareUpdate(
        {},
        buildPolygonPackage({
          ...fixture,
          statements: [{ ...fixture.statements![0], name: 'Sum v2' }],
        }),
      ),
    );
    const after = await worker.problems
      .findOne({ code: 'sum' })
      .select('+data');
    expect(after!._id).toBe(before!._id);
    expect(after).toMatchObject({
      name: 'Sum v2',
      points: 800,
      groupId,
      typeIds: [typeId],
      authors: [requesterId],
      translations: [],
      dataVersion: 2,
    });
    expect(imageCount()).toBe(imagesBefore + 1);
    expect(readdirSync(dataDirectory('sum')).sort()).toEqual([
      'checker.cpp',
      'init.yml',
      'tests.zip',
    ]);
  });

  it('applies what an update is given and records only real changes', async () => {
    const latestChanges = async () =>
      Object.keys(
        (await revisions
          .findOne({ action: 'import' })
          .sort({ createdAt: -1, _id: -1 }))!.changes,
      );
    await processor.process(
      bareUpdate({ points: 1200, groupId: otherGroupId, authors: [writerId] }),
    );
    expect(await worker.problems.findOne({ code: 'sum' })).toMatchObject({
      points: 1200,
      groupId: otherGroupId,
      authors: [writerId],
      typeIds: [typeId],
    });
    expect(await latestChanges()).toEqual(
      expect.arrayContaining(['points', 'groupId', 'authors']),
    );
    await processor.process(
      bareUpdate({
        points: 1200,
        groupId: otherGroupId,
        authors: [writerId],
        typeIds: [typeId],
        allowedLanguages: [],
        curators: [],
      }),
    );
    expect(await latestChanges()).not.toEqual(
      expect.arrayContaining(['points']),
    );
    expect(await latestChanges()).toEqual(
      expect.not.arrayContaining([
        'groupId',
        'typeIds',
        'authors',
        'curators',
        'allowedLanguages',
        'points',
      ]),
    );
  });

  it('keeps a published editorial on re-import and removes it when the package has no tutorial', async () => {
    await worker.problems.updateOne(
      { code: 'sum' },
      { $set: { 'solution.isPublic': true, 'solution.authors': [writerId] } },
    );
    await processor.process(bareUpdate());
    expect(
      (await worker.problems.findOne({ code: 'sum' }))!.solution,
    ).toMatchObject({ isPublic: true, authors: [writerId] });
    const noTutorial = {
      ...fixture,
      statements: [
        {
          ...fixture.statements![0],
          properties: properties({ legend: 'Add.', tutorial: '' }),
        },
      ],
    };
    await processor.process(
      bareUpdate(
        { appendMainSolution: false },
        buildPolygonPackage(noTutorial),
      ),
    );
    expect(
      (await worker.problems.findOne({ code: 'sum' }))!.solution,
    ).toBeNull();
  });

  it('refuses an update when the data version moved since the job was queued', async () => {
    const { dataVersion } = (await worker.problems.findOne({ code: 'sum' }))!;
    const imagesBefore = imageCount();
    await expect(
      processor.process(bareUpdate({ expectedDataVersion: dataVersion - 1 })),
    ).rejects.toThrow('Test data changed since the import was queued');
    expect(imageCount()).toBe(imagesBefore);
    await processor.process(bareUpdate({ expectedDataVersion: dataVersion }));
    expect(await worker.problems.findOne({ code: 'sum' })).toMatchObject({
      dataVersion: dataVersion + 1,
    });
  });

  it('drops data files the new configuration no longer uses', async () => {
    writeFileSync(join(dataDirectory('sum'), 'old-generator.cpp'), '//');
    await worker.problems.updateOne(
      { code: 'sum' },
      { $set: { 'data.generator': 'old-generator.cpp' } },
    );
    await processor.process(
      bareUpdate(
        {},
        buildPolygonPackage({
          ...fixture,
          checker: { name: 'std::wcmp.cpp', path: 'files/check.cpp' },
        }),
      ),
    );
    expect(readdirSync(dataDirectory('sum')).sort()).toEqual([
      'init.yml',
      'tests.zip',
    ]);
  });

  it('refuses the wrong mode before writing anything', async () => {
    const imagesBefore = imageCount();
    await expect(processor.process(job({ mode: 'create' }))).rejects.toThrow(
      'problem with code sum already exists',
    );
    await expect(
      processor.process(job({ mode: 'update', code: 'ghost' })),
    ).rejects.toThrow('problem with code ghost not found');
    expect(existsSync(dataDirectory('ghost'))).toBe(false);
    expect(imageCount()).toBe(imagesBefore);
  });

  it('fails on a disallowed statement character, a non-full package and a missing problem.xml, leaving nothing behind', async () => {
    const imagesBefore = imageCount();
    const badStatement = {
      ...fixture.statements![0],
      properties: properties({ legend: 'a − b ![image](fig.png)' }),
    };
    await expect(
      processor.process(
        job(
          { code: 'bad' },
          buildPolygonPackage({ ...fixture, statements: [badStatement] }),
        ),
      ),
    ).rejects.toThrow('disallowed characters');
    expect(await worker.problems.countDocuments({ code: 'bad' })).toBe(0);
    expect(existsSync(dataDirectory('bad'))).toBe(false);
    expect(imageCount()).toBe(imagesBefore);
    await expect(
      processor.process(
        job(
          { code: 'nofull' },
          buildPolygonPackage({
            ...fixture,
            omitEntries: ['tests/01', 'tests/01.a'],
          }),
        ),
      ),
    ).rejects.toThrow('not full package');
    await expect(
      processor.process(
        job(
          { code: 'nofull' },
          buildPolygonPackage({ ...fixture, omitEntries: ['tests/03.a'] }),
        ),
      ),
    ).rejects.toThrow('not full package');
    expect(existsSync(dataDirectory('nofull'))).toBe(false);
    await expect(
      processor.process(
        job(
          { code: 'noxml' },
          buildPolygonPackage({ ...fixture, withProblemXml: false }),
        ),
      ),
    ).rejects.toThrow('problem.xml not found');
    expect(imageCount()).toBe(imagesBefore);
    expect(readdirSync(join(worker.problemDataRoot, '.imports'))).toEqual([]);
  });

  it('rejects an editorial whose appended source breaks the statement limits', async () => {
    const imagesBefore = imageCount();
    await expect(
      processor.process(
        job(
          { code: 'quotes' },
          buildPolygonPackage({
            ...fixture,
            solution: {
              path: 'solutions/main.cpp',
              type: 'cpp.g++17',
              code: 'a − b',
            },
          }),
        ),
      ),
    ).rejects.toThrow('disallowed characters');
    expect(await worker.problems.countDocuments({ code: 'quotes' })).toBe(0);
    expect(imageCount()).toBe(imagesBefore);
  });

  it('writes full-markup statements only for a requester holding judge.problem_full_markup', async () => {
    await expect(
      processor.process(job({ code: 'fullmark', isFullMarkup: true })),
    ).rejects.toThrow('judge.problem_full_markup');
    expect(await worker.problems.countDocuments({ code: 'fullmark' })).toBe(0);
    expect(existsSync(dataDirectory('fullmark'))).toBe(false);
    await processor.process(
      job({ code: 'fullmark', isFullMarkup: true, requesterId: writerId }),
    );
    expect(await worker.problems.findOne({ code: 'fullmark' })).toMatchObject({
      isFullMarkup: true,
    });
  });

  it('accepts full-markup writers through a group or superuser rights and refuses inactive or unknown requesters', async () => {
    const group = await worker.module
      .get<Model<Group>>(getModelToken(Group.name))
      .create({ name: 'Markup', permissions: ['judge.problem_full_markup'] });
    const viaGroup = await worker.users.create({
      username: 'grouped',
      password: '!',
      isActive: true,
      groups: [group._id],
    });
    const superuser = await worker.users.create({
      username: 'root',
      password: '!',
      isActive: true,
      isSuperuser: true,
    });
    const inactive = await worker.users.create({
      username: 'dormant',
      password: '!',
      permissions: ['judge.problem_full_markup'],
    });
    await processor.process(
      job({ code: 'viagroup', isFullMarkup: true, requesterId: viaGroup._id }),
    );
    await processor.process(
      job({ code: 'viaroot', isFullMarkup: true, requesterId: superuser._id }),
    );
    for (const requester of [inactive._id, newId()]) {
      await expect(
        processor.process(
          job({ code: 'denied', isFullMarkup: true, requesterId: requester }),
        ),
      ).rejects.toThrow('judge.problem_full_markup');
    }
    expect(await worker.problems.countDocuments({ code: 'denied' })).toBe(0);
    expect(existsSync(dataDirectory('denied'))).toBe(false);
  });

  it('refuses an update whose markup mode changed since the job was queued', async () => {
    const imagesBefore = imageCount();
    await expect(
      processor.process(
        bareUpdate({ isFullMarkup: true, requesterId: writerId }),
      ),
    ).rejects.toThrow('changed');
    expect(imageCount()).toBe(imagesBefore);
  });

  it('loses cleanly to a concurrent data write: nothing changes, staged files and images are removed', async () => {
    const problem = await worker.problems
      .findOne({ code: 'sum' })
      .select('+data');
    const repository = worker.module.get(PolygonImportRepository);
    const resolveTarget = repository.resolveTarget.bind(repository);
    const stale = jest
      .spyOn(repository, 'resolveTarget')
      .mockImplementationOnce(async (importJob) => {
        const target = await resolveTarget(importJob);
        await worker.problems.updateOne(
          { code: 'sum' },
          { $inc: { dataVersion: 1 } },
        );
        return target;
      });
    const imagesBefore = imageCount();
    const filesBefore = readdirSync(dataDirectory('sum')).sort();
    await expect(
      processor.process(
        bareUpdate(
          {},
          buildPolygonPackage({
            ...fixture,
            statements: [{ ...fixture.statements![0], name: 'Lost' }],
          }),
        ),
      ),
    ).rejects.toThrow('changed');
    stale.mockRestore();
    expect(await worker.problems.findOne({ code: 'sum' })).toMatchObject({
      name: problem!.name,
      dataVersion: problem!.dataVersion + 1,
    });
    expect(readdirSync(dataDirectory('sum')).sort()).toEqual(filesBefore);
    expect(imageCount()).toBe(imagesBefore);
  });

  it('removes the empty data directory of an update that fails after staging', async () => {
    await worker.problems.create({
      code: 'nodir',
      name: 'No dir',
      timeLimit: 1,
      memoryLimit: 1024,
      points: 800,
      typeIds: [typeId],
      groupId,
    });
    const repository = worker.module.get(PolygonImportRepository);
    const resolveTarget = repository.resolveTarget.bind(repository);
    const stale = jest
      .spyOn(repository, 'resolveTarget')
      .mockImplementationOnce(async (importJob) => {
        const target = await resolveTarget(importJob);
        await worker.problems.updateOne(
          { code: 'nodir' },
          { $inc: { dataVersion: 1 } },
        );
        return target;
      });
    await expect(
      processor.process(bareUpdate({ code: 'nodir' })),
    ).rejects.toThrow('changed');
    stale.mockRestore();
    expect(existsSync(dataDirectory('nodir'))).toBe(false);
  });

  it.each([
    [
      'a duplicate code',
      { code: 11000, keyPattern: { code: 1 } },
      'already exists',
    ],
    ['a too-large document', { code: 10334 }, 'too large'],
  ])(
    'maps %s from the transaction to an import error and cleans up',
    async (_label, mongoError, message) => {
      const imagesBefore = imageCount();
      const create = jest
        .spyOn(
          worker.module.get<Model<Problem>>(getModelToken(Problem.name)),
          'create',
        )
        .mockRejectedValueOnce(Object.assign(new Error('mongo'), mongoError));
      await expect(processor.process(job({ code: 'raced' }))).rejects.toThrow(
        message,
      );
      create.mockRestore();
      expect(existsSync(dataDirectory('raced'))).toBe(false);
      expect(imageCount()).toBe(imagesBefore);
    },
  );

  it('refuses an update of a mirror problem', async () => {
    await worker.problems.updateOne(
      { code: 'plain' },
      { $set: { mirrorOf: otherGroupId } },
    );
    await expect(
      processor.process(bareUpdate({ code: 'plain' })),
    ).rejects.toThrow('mirror');
    await worker.problems.updateOne(
      { code: 'plain' },
      { $set: { mirrorOf: null } },
    );
  });
});
