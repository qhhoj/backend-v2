import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Model } from 'mongoose';
import { StorageService } from '@libs/common';
import { newId, Problem, toUuid } from '@libs/database';
import {
  LEGACY_STORAGE_BACKFILL_KEY,
  ProblemDataFilesService,
} from '@libs/problems';
import { setupMigrationsTest } from '../../../test/migrations-setup';
import type { MigrationsTest } from '../../../test/migrations-setup';
import { ProblemDataBytesMigration } from './problem-databytes.migration';
import { ProblemDataBytesRepository } from './problem-databytes.repository';

describe('problem dataBytes migration', () => {
  let test: MigrationsTest;
  let problems: Model<Problem>;
  let migration: ProblemDataBytesMigration;
  let counter = 0;

  beforeAll(async () => {
    test = await setupMigrationsTest();
    problems = test.model(Problem.name);
    migration = test.module.get(ProblemDataBytesMigration);
  });
  beforeEach(() => test.redis.del(LEGACY_STORAGE_BACKFILL_KEY));
  afterAll(() => test.teardown());

  const seed = async (
    bytes: number | null,
    extra: Record<string, unknown> = {},
  ) => {
    counter += 1;
    const code = `bf${counter}`;
    if (bytes !== null) {
      mkdirSync(join(test.problemDataRoot, code), { recursive: true });
      writeFileSync(
        join(test.problemDataRoot, code, 'tests.zip'),
        Buffer.alloc(bytes),
      );
    }
    // Straight into the collection: some rows need a code the schema would refuse, and `_id` must be a BSON UUID like the real ones.
    await problems.collection.insertOne({
      _id: toUuid(newId()),
      code,
      name: code,
      timeLimit: 1,
      memoryLimit: 1024,
      points: 1,
      dataBytes: 999,
      ...extra,
    } as never);
    return code;
  };
  const stored = async (code: string) =>
    (await problems.findOne({ code }, { dataBytes: 1 }).lean())?.dataBytes;
  const media = (relativePath: string, bytes: number) => {
    const path = join(test.mediaRoot, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, Buffer.alloc(bytes));
    return `/media/${relativePath}`;
  };

  it('sets every problem to the bytes on disk, zero when the directory is gone, fills a missing value, and a second run changes nothing', async () => {
    const full = await seed(1500);
    const gone = await seed(null);
    const legacy = await seed(40, { dataBytes: undefined });
    await migration.run();
    expect(await stored(full)).toBe(1500);
    expect(await stored(gone)).toBe(0);
    expect(await stored(legacy)).toBe(40);
    const after = await problems.find().sort({ _id: 1 }).lean();
    expect(await migration.run()).toBe(0);
    expect(await problems.find().sort({ _id: 1 }).lean()).toEqual(after);
  });

  it('measures a problem whose stored code is not a valid directory name as zero instead of failing', async () => {
    await seed(null, { code: 'Bad Code!' });
    await migration.run();
    expect(await stored('Bad Code!')).toBe(0);
  });

  it('keeps the value a data write recorded while the problem was being measured', async () => {
    const code = await seed(100);
    const files = test.module.get(ProblemDataFilesService);
    const real = files.bytesOf.bind(files);
    const measuring = jest
      .spyOn(files, 'bytesOf')
      .mockImplementation(async (target) => {
        const size = await real(target);
        if (target === code)
          await problems.updateOne({ code }, { dataBytes: 777 });
        return size;
      });
    await migration.run();
    measuring.mockRestore();
    expect(await stored(code)).toBe(777);
  });

  it('measures the uploaded PDF statement and material, zero for a missing file or an external link', async () => {
    const files = (code: string) =>
      problems
        .findOne({ code }, { pdfStatementBytes: 1, materialBytes: 1 })
        .lean();
    const both = await seed(10, {
      pdfStatementUrl: media(`pdf/${newId()}.pdf`, 300),
      materialUrl: media(`materials/${newId()}/de.docx`, 70),
    });
    const missing = await seed(null, {
      pdfStatementUrl: `/media/pdf/${newId()}.pdf`,
      materialUrl: 'https://drive.example.com/de.zip',
      pdfStatementBytes: 5,
    });
    await migration.run();
    expect(await files(both)).toMatchObject({
      pdfStatementBytes: 300,
      materialBytes: 70,
    });
    expect(await files(missing)).toMatchObject({
      pdfStatementBytes: 0,
      materialBytes: 0,
    });
  });

  it('keeps the size an upload recorded while the file was being measured', async () => {
    const pdf = `pdf/${newId()}.pdf`;
    const code = await seed(null, { pdfStatementUrl: media(pdf, 50) });
    const storage = test.module.get(StorageService);
    const real = storage.bytesOf.bind(storage);
    const measuring = jest
      .spyOn(storage, 'bytesOf')
      .mockImplementation(async (target) => {
        const size = await real(target);
        if (target === pdf)
          await problems.updateOne(
            { code },
            { pdfStatementUrl: '/media/pdf/new.pdf', pdfStatementBytes: 9 },
          );
        return size;
      });
    await migration.run();
    measuring.mockRestore();
    expect(
      await problems.findOne({ code }, { pdfStatementBytes: 1 }).lean(),
    ).toMatchObject({ pdfStatementBytes: 9 });
  });

  it("sets the earlier releases' Redis flag only when every problem was measured", async () => {
    await migration.run();
    expect(await test.redis.get(LEGACY_STORAGE_BACKFILL_KEY)).toBe('1');
    await test.redis.del(LEGACY_STORAGE_BACKFILL_KEY);
    const failing = jest
      .spyOn(test.module.get(ProblemDataBytesRepository), 'setSizes')
      .mockRejectedValueOnce(new Error('mongo down'));
    await seed(5);
    await expect(migration.run()).rejects.toThrow('mongo down');
    failing.mockRestore();
    expect(await test.redis.get(LEGACY_STORAGE_BACKFILL_KEY)).toBeNull();
  });
});
