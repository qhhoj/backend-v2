import {
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { StorageService } from '@libs/common';
import {
  PackageCacheService,
  PACKAGE_QUEUE,
  PACKAGE_SWEEP_SCHEDULER,
} from '@libs/problems';
import {
  PACKAGE_LIMITS,
  DEFAULT_PACKAGE_LIMITS,
  PackageTooLargeError,
} from '../src/jobs/problem-package/package-zip';
import { ProblemPackageService } from '../src/jobs/problem-package/problem-package.service';
import { softDeleteWorker } from './deleted-problem-fixtures';
import { seedProblem } from './effects-fixtures';
import { readZip } from './read-zip';
import { setupWorkerTest } from './setup';
import type { WorkerTest } from './setup';

describe('problem package build', () => {
  const limits = { ...DEFAULT_PACKAGE_LIMITS };
  let worker: WorkerTest;
  let service: ProblemPackageService;
  let cache: PackageCacheService;
  let storage: StorageService;
  const dataDirectory = (code: string) => join(worker.problemDataRoot, code);
  const packagesDirectory = () => join(worker.pdfCacheRoot, 'packages');

  const seedPackageProblem = async (code: string) => {
    const problem = await seedProblem(worker, {
      code,
      name: 'Sum',
      description: 'Add two numbers.',
      translations: [
        {
          language: 'vi',
          name: 'Tong',
          description: 'Cong hai so.',
          descriptionHtml: '',
        },
      ],
      dataVersion: 3,
      data: {
        archive: 'tests.zip',
        generator: null,
        customChecker: 'checker.cpp',
        customGrader: null,
        customHeader: null,
        checker: 'standard',
        checkerArgs: null,
        grader: 'standard',
        graderArgs: null,
        outputPrefix: null,
        outputLimit: null,
        unicode: false,
        nobigmath: false,
        feedback: '',
        cases: [
          {
            type: 'C',
            input: '1.in',
            output: '1.out',
            points: 100,
            isPretest: false,
            generatorArgs: '',
            checker: '',
            checkerArgs: null,
            outputPrefix: null,
            outputLimit: null,
          },
        ],
      },
    });
    mkdirSync(dataDirectory(code), { recursive: true });
    writeFileSync(join(dataDirectory(code), 'tests.zip'), 'ARCHIVE-BYTES');
    writeFileSync(join(dataDirectory(code), 'checker.cpp'), '// checker');
    writeFileSync(join(dataDirectory(code), 'init.yml'), 'cases: []');
    mkdirSync(worker.pdfCacheRoot, { recursive: true });
    writeFileSync(join(worker.pdfCacheRoot, `${code}.en.pdf`), '%PDF-1.4');
    const materialUrl = await storage.save(
      `materials/${problem._id}/notes.txt`,
      Buffer.from('NOTES'),
    );
    await worker.problems.updateOne({ _id: problem._id }, { materialUrl });
    return problem;
  };

  beforeAll(async () => {
    worker = await setupWorkerTest({
      overrides: [{ provide: PACKAGE_LIMITS, useValue: limits }],
    });
    service = worker.module.get(ProblemPackageService);
    cache = worker.module.get(PackageCacheService);
    storage = worker.module.get(StorageService);
  });
  afterAll(() => worker.teardown());
  beforeEach(() => {
    limits.maxBytes = DEFAULT_PACKAGE_LIMITS.maxBytes;
  });

  it('puts everything the problem consists of into one zip', async () => {
    const problem = await seedPackageProblem('pkg_sum');
    const key = await service.build({ code: problem.code, key: 'ignored' });
    const files = await readZip(cache.pathOf(problem.code, key));
    expect(Object.keys(files).sort()).toEqual(
      [
        'package.json',
        'statements/en.md',
        'statements/vi.md',
        'data/tests.zip',
        'data/init.yml',
        'sources/checker.cpp',
        'material/notes.txt',
        'statement.en.pdf',
      ].sort(),
    );
    expect(files['statements/en.md']).toBe('Add two numbers.');
    expect(files['statements/vi.md']).toBe('Cong hai so.');
    expect(files['data/tests.zip']).toBe('ARCHIVE-BYTES');
    expect(files['sources/checker.cpp']).toBe('// checker');
    expect(files['material/notes.txt']).toBe('NOTES');
    const manifest = JSON.parse(files['package.json']) as {
      format: string;
      problem: { code: string };
      data: { cases: Array<{ input: string }> };
    };
    expect(manifest.format).toBe('qhhoj-package');
    expect(manifest.problem.code).toBe('pkg_sum');
    expect(manifest.data.cases.map((row) => row.input)).toEqual(['1.in']);
  });

  it('refuses a data file that is a symlink out of the data root, and builds no zip', async () => {
    const problem = await seedPackageProblem('pkg_link');
    const outside = join(worker.pdfCacheRoot, 'outside-secret.txt');
    writeFileSync(outside, 'SECRET');
    const checker = join(dataDirectory(problem.code), 'checker.cpp');
    rmSync(checker);
    symlinkSync(outside, checker);
    await expect(
      service.build({ code: problem.code, key: 'ignored' }),
    ).rejects.toThrow('symlink');
    expect(
      readdirSync(packagesDirectory()).filter((name) =>
        name.startsWith('pkg_link.'),
      ),
    ).toEqual([]);
  });

  it('refuses a data row that names a path outside the problem directory', async () => {
    const problem = await seedPackageProblem('pkg_dots');
    await worker.problems.updateOne(
      { _id: problem._id },
      { 'data.archive': '../pkg_sum/tests.zip' },
    );
    await expect(
      service.build({ code: problem.code, key: 'ignored' }),
    ).rejects.toThrow();
  });

  it('builds the same content once and does not rewrite the file', async () => {
    const problem = await seedPackageProblem('pkg_once');
    const key = await service.build({ code: problem.code, key: 'x' });
    const path = cache.pathOf(problem.code, key);
    const { ino } = statSync(path);
    expect(await service.build({ code: problem.code, key: 'x' })).toBe(key);
    expect(statSync(path).ino).toBe(ino);
  });

  it('gives an edited problem a new key and drops the old zip', async () => {
    const problem = await seedPackageProblem('pkg_edit');
    const first = await service.build({ code: problem.code, key: 'x' });
    await worker.problems.updateOne(
      { _id: problem._id },
      { description: 'Add three numbers.' },
    );
    const second = await service.build({ code: problem.code, key: first });
    expect(second).not.toBe(first);
    const names = readdirSync(packagesDirectory()).filter((name) =>
      name.startsWith('pkg_edit.'),
    );
    expect(names).toEqual([`pkg_edit.${second}.zip`]);
    expect(
      (await readZip(cache.pathOf(problem.code, second)))['statements/en.md'],
    ).toBe('Add three numbers.');
  });

  it('refuses an oversize package before any file exists', async () => {
    const problem = await seedPackageProblem('pkg_big');
    limits.maxBytes = 10;
    await expect(
      service.build({ code: problem.code, key: 'x' }),
    ).rejects.toBeInstanceOf(PackageTooLargeError);
    expect(
      readdirSync(packagesDirectory()).filter((name) =>
        name.startsWith('pkg_big.'),
      ),
    ).toEqual([]);
  });

  it('does not build a deleted problem', async () => {
    const problem = await seedPackageProblem('pkg_gone');
    await softDeleteWorker(worker, problem._id);
    await expect(
      service.build({ code: problem.code, key: 'x' }),
    ).rejects.toThrow('problem not found');
  });

  it('sweeps cached packages older than a day', async () => {
    const old = await seedPackageProblem('pkg_old');
    const fresh = await seedPackageProblem('pkg_fresh');
    const oldKey = await service.build({ code: old.code, key: 'x' });
    const freshKey = await service.build({ code: fresh.code, key: 'x' });
    const stale = new Date(Date.now() - 2 * 86_400_000);
    utimesSync(cache.pathOf(old.code, oldKey), stale, stale);
    expect(await service.sweep()).toBeGreaterThanOrEqual(1);
    expect(await cache.has(old.code, oldKey)).toBe(false);
    expect(await cache.has(fresh.code, freshKey)).toBe(true);
  });
});

describe('problem package sweep scheduler', () => {
  let worker: WorkerTest;
  // `seedBeforeBoot` also keeps the setup from flushing Redis after boot, which would drop the scheduler.
  beforeAll(async () => {
    worker = await setupWorkerTest({ seedBeforeBoot: () => Promise.resolve() });
  });
  afterAll(() => worker.teardown());

  it('registers the daily sweep once, whatever the number of boots', async () => {
    const queue = worker.module.get<Queue>(getQueueToken(PACKAGE_QUEUE));
    const schedulers = await queue.getJobSchedulers();
    const ours = schedulers.filter(
      (scheduler) => scheduler.key === PACKAGE_SWEEP_SCHEDULER,
    );
    expect(ours).toHaveLength(1);
    expect(ours[0].pattern).toBe('15 4 * * *');
  });
});
