import {
  Language,
  LanguageSchema,
  newId,
  Problem,
  ProblemSchema,
  toUuid,
  uuidStr,
} from '@libs/database';
import { startMongo } from '@libs/database/testing';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createConnection, type Connection } from 'mongoose';
import { parseKeep, pruneLanguages } from './language-pruner';

describe('pruneLanguages', () => {
  let mongo: MongoMemoryReplSet;
  let connection: Connection;
  const ids: Record<string, string> = {};
  const languages = () =>
    connection.model<Language>(Language.name, LanguageSchema);
  const problems = () => connection.model<Problem>(Problem.name, ProblemSchema);
  const allowedOf = async (code: string) =>
    (
      (await problems().collection.findOne({ code }))!
        .allowedLanguages as unknown[]
    )
      .map(uuidStr)
      .sort();
  const problemRow = (code: string, keys: string[]) => ({
    _id: toUuid(newId()),
    code,
    allowedLanguages: keys.map((key) => toUuid(ids[key])),
  });

  beforeAll(async () => {
    mongo = await startMongo();
    connection = await createConnection(mongo.getUri()).asPromise();
  });
  afterAll(async () => {
    await connection.close();
    await mongo.stop();
  });

  beforeEach(async () => {
    await connection.dropDatabase();
    for (const key of ['PY3', 'CPP17', 'PY2', 'RUST'])
      ids[key] = uuidStr(
        (
          await languages().create({
            key,
            name: key,
            commonName: key,
            ace: 'text',
            pygments: 'text',
            extension: 'txt',
            includeInProblem: true,
          })
        )._id,
      );
    // Raw inserts: the pruner touches only `allowedLanguages`, so the rest of the problem shape is irrelevant here.
    await problems().collection.insertMany([
      problemRow('mixed', ['PY3', 'PY2', 'RUST']),
      problemRow('clean', ['CPP17']),
      problemRow('legacy_only', ['PY2']),
    ] as never[]);
  });

  it('removes every language outside the keep list from all problems and disables those rows', async () => {
    const summary = await pruneLanguages(connection, {
      keep: ['PY3', 'CPP17'],
      dryRun: false,
    });
    expect(summary).toEqual({
      keptLanguages: ['CPP17', 'PY3'],
      prunedLanguages: ['PY2', 'RUST'],
      problemsChanged: 2,
      languagesDisabled: 2,
      emptiedProblems: ['legacy_only'],
    });
    expect(await allowedOf('mixed')).toEqual([ids.PY3]);
    expect(await allowedOf('clean')).toEqual([ids.CPP17]);
    expect(await allowedOf('legacy_only')).toEqual([]);
    const rows = await languages()
      .find({}, { key: 1, includeInProblem: 1 })
      .lean();
    expect(
      Object.fromEntries(rows.map((row) => [row.key, row.includeInProblem])),
    ).toEqual({
      PY3: true,
      CPP17: true,
      PY2: false,
      RUST: false,
    });
  });

  it('matches keys case-insensitively', async () => {
    const summary = await pruneLanguages(connection, {
      keep: ['py3', 'CPP17', 'RUST'],
      dryRun: false,
    });
    expect(summary.prunedLanguages).toEqual(['PY2']);
    expect(await allowedOf('mixed')).toEqual([ids.PY3, ids.RUST].sort());
  });

  it('refuses a keep key that names no language before writing anything', async () => {
    await expect(
      pruneLanguages(connection, {
        keep: ['PY3', 'CPP17', 'KOTLINN'],
        dryRun: false,
      }),
    ).rejects.toThrow('--keep names no language: KOTLINN; nothing changed');
    expect(await allowedOf('mixed')).toEqual(
      [ids.PY3, ids.PY2, ids.RUST].sort(),
    );
    const rows = await languages().find({}, { includeInProblem: 1 }).lean();
    expect(rows.every((row) => row.includeInProblem)).toBe(true);
  });

  it('is idempotent', async () => {
    await pruneLanguages(connection, { keep: ['PY3', 'CPP17'], dryRun: false });
    const again = await pruneLanguages(connection, {
      keep: ['PY3', 'CPP17'],
      dryRun: false,
    });
    expect(again).toMatchObject({
      prunedLanguages: ['PY2', 'RUST'],
      problemsChanged: 0,
      languagesDisabled: 0,
      emptiedProblems: [],
    });
  });

  it('dry run counts but writes nothing', async () => {
    const summary = await pruneLanguages(connection, {
      keep: ['PY3', 'CPP17'],
      dryRun: true,
    });
    expect(summary).toMatchObject({
      problemsChanged: 2,
      languagesDisabled: 2,
      emptiedProblems: ['legacy_only'],
    });
    expect(await allowedOf('mixed')).toEqual(
      [ids.PY3, ids.PY2, ids.RUST].sort(),
    );
    expect(
      (await languages().findOne({ key: 'PY2' }).lean())!.includeInProblem,
    ).toBe(true);
  });

  it('keeps the row of a pruned language, so legacy submissions in it still name their language (GAS32)', async () => {
    const gas32 = await languages().create({
      key: 'GAS32',
      name: 'Assembly (x86)',
      commonName: 'Assembly',
      ace: 'assembly_x86',
      pygments: 'gas',
      extension: 'asm',
      includeInProblem: true,
    });
    ids.GAS32 = uuidStr(gas32._id);
    const submission = { _id: toUuid(newId()), language: toUuid(ids.GAS32) };
    await connection.collection('submissions').insertOne(submission as never);
    await problems().collection.insertOne(
      problemRow('asm', ['GAS32']) as never,
    );

    const summary = await pruneLanguages(connection, {
      keep: ['PY3', 'CPP17', 'PY2', 'RUST'],
      dryRun: false,
    });

    expect(summary).toMatchObject({
      prunedLanguages: ['GAS32'],
      problemsChanged: 1,
      languagesDisabled: 1,
      emptiedProblems: ['asm'],
    });
    expect(await allowedOf('asm')).toEqual([]);
    const stored = await connection
      .collection('submissions')
      .findOne({ _id: submission._id } as never);
    const row = await languages().findById(uuidStr(stored!.language)).lean();
    expect(row).toMatchObject({
      key: 'GAS32',
      name: 'Assembly (x86)',
      includeInProblem: false,
    });
  });
});

describe('parseKeep', () => {
  it('trims, upper-cases and de-duplicates', () => {
    expect(parseKeep(' py3,CPP17 ,PY3,,')).toEqual(['PY3', 'CPP17']);
  });

  it('refuses a list without a runtime language, as from an unset fleet variable', () => {
    for (const unset of [',OUTPUT', 'OUTPUT,TEXT', ' , output '])
      expect(() => parseKeep(unset)).toThrow(
        '--keep names no runtime language',
      );
    expect(parseKeep(',OUTPUT,PY3')).toEqual(['OUTPUT', 'PY3']);
  });

  it('refuses an empty list', () => {
    expect(() => parseKeep(' , ')).toThrow(
      '--keep needs at least one language key',
    );
  });
});
