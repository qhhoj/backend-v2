import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encryptionKey } from '@libs/common';
import { TEST_ENV } from '@libs/common/testing';
import {
  Contest,
  ContestSchema,
  Problem,
  ProblemSchema,
  uuidStr,
} from '@libs/database';
import { startMongo } from '@libs/database/testing';
import { createConnection } from 'mongoose';
import type { Connection } from 'mongoose';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { fromBuffer } from 'yauzl';
import { seedE2e } from './seed-e2e';

const zipEntryNames = (zip: Buffer): Promise<string[]> =>
  new Promise((resolve, reject) =>
    fromBuffer(zip, { lazyEntries: true }, (error, file) => {
      if (error) return reject(error);
      const names: string[] = [];
      file.on('entry', (entry: { fileName: string }) => {
        names.push(entry.fileName);
        file.readEntry();
      });
      file.on('end', () => resolve(names.sort()));
      file.readEntry();
    }),
  );

describe('seed:e2e content', () => {
  let replSet: MongoMemoryReplSet;
  let connection: Connection;
  let root: string;
  const options = () => ({
    problemDataRoot: root,
    adminPassword: 'a-long-admin-password',
    userPassword: 'a-long-user-password',
    encryptionKey: encryptionKey(TEST_ENV.ENCRYPTION_KEY),
    judgeName: 'e2e-judge',
    judgeKey: 'e2e-judge-key',
  });
  const problemsModel = () =>
    connection.model<Problem>(Problem.name, ProblemSchema);
  const contestsModel = () =>
    connection.model<Contest>(Contest.name, ContestSchema);

  beforeAll(async () => {
    replSet = await startMongo();
    connection = await createConnection(replSet.getUri('qhhoj')).asPromise();
    root = mkdtempSync(join(tmpdir(), 'seed-content-'));
  });
  afterAll(async () => {
    await connection.close();
    await replSet.stop();
    rmSync(root, { recursive: true, force: true });
  });

  it('seeds a running and an ended contest with the right problems in order', async () => {
    const summary = await seedE2e(connection, options());
    expect(summary.contests).toEqual(['e2e_live', 'e2e_past']);
    const now = Date.now();
    const live = (await contestsModel().findOne({ key: 'e2e_live' }).lean())!;
    const past = (await contestsModel().findOne({ key: 'e2e_past' }).lean())!;
    expect(live.startTime.getTime()).toBeLessThan(now);
    expect(live.endTime.getTime()).toBeGreaterThan(now);
    expect(past.endTime.getTime()).toBeLessThan(now);
    const codes = async (contest: Contest) => {
      const rows = await problemsModel()
        .find({ _id: { $in: contest.problems.map((row) => row.problem) } })
        .lean();
      return contest.problems.map(
        (row) =>
          rows.find((problem) => uuidStr(problem._id) === uuidStr(row.problem))!
            .code,
      );
    };
    expect(await codes(live)).toEqual(['e2e_sum', 'e2e_max']);
    expect(await codes(past)).toEqual(['e2e_sum']);
    expect(live.formatName).toBe('icpc');
  });

  it('packs every case file of e2e_max into its tests.zip and splits 100 points over the cases', async () => {
    await seedE2e(connection, options());
    const problem = (await problemsModel()
      .findOne({ code: 'e2e_max' })
      .select('+data')
      .lean())!;
    expect(problem.data!.archive).toBe('tests.zip');
    expect(problem.data!.cases.map((testCase) => testCase.points)).toEqual([
      50, 50,
    ]);
    const zip = readFileSync(join(root, 'e2e_max', 'tests.zip'));
    expect(await zipEntryNames(zip)).toEqual([
      '1.in',
      '1.out',
      '2.in',
      '2.out',
    ]);
    expect(readFileSync(join(root, 'e2e_max', 'init.yml'), 'utf8')).toContain(
      'tests.zip',
    );
  });

  it('is idempotent: a second run changes no row and rewrites no file', async () => {
    await seedE2e(connection, options());
    const snapshot = async () =>
      JSON.stringify([
        await connection
          .collection('problems')
          .find()
          .sort({ code: 1 })
          .toArray(),
        await connection
          .collection('contests')
          .find()
          .sort({ key: 1 })
          .toArray(),
        await connection.collection('users').countDocuments(),
        await connection.collection('judges').countDocuments(),
      ]);
    const zipPath = join(root, 'e2e_max', 'tests.zip');
    const before = { rows: await snapshot(), zip: readFileSync(zipPath) };
    await seedE2e(connection, options());
    expect(await snapshot()).toBe(before.rows);
    expect(readFileSync(zipPath).equals(before.zip)).toBe(true);
  });
});
