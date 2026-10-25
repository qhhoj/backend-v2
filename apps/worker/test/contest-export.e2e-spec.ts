import {
  existsSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  contestDataPath,
  contestDataTempPath,
  contestExportPath,
  contestExportTempPath,
} from '@libs/contests';
import { newId } from '@libs/database';
import type {
  Contest,
  ContestParticipation,
  Language,
  Problem,
} from '@libs/database';
import { ContestExportRepository } from '../src/jobs/contest-export/contest-export.repository';
import { ContestExportService } from '../src/jobs/contest-export/contest-export.service';
import { ContestZipSweepService } from '../src/jobs/contest-export/contest-zip-sweep.service';
import {
  CONTEST_EXPORT_LIMITS,
  ContestExportError,
  DEFAULT_CONTEST_EXPORT_LIMITS,
} from '../src/jobs/contest-export/contest-export.limits';
import {
  seedContest,
  seedContestSubmission,
  seedParticipation,
  seedProblem,
  seedUser,
} from './effects-fixtures';
import { readZip } from './read-zip';
import { setupWorkerTest } from './setup';
import type { WorkerTest } from './setup';

describe('contest export', () => {
  const limits = { ...DEFAULT_CONTEST_EXPORT_LIMITS };
  let worker: WorkerTest;
  let service: ContestExportService;
  let cpp: Language;
  let sum: Problem;
  let contest: Contest;
  const userIds: Record<string, string> = {};
  const entry = (problem: Problem, order: number) => ({
    problem: problem._id,
    points: 100,
    partial: true,
    isPretested: false,
    order,
    outputPrefixOverride: null,
    maxSubmissions: null,
  });
  const joinAs = (
    username: string,
    extra: Partial<ContestParticipation> = {},
  ) => seedParticipation(worker, contest._id, userIds[username], extra);
  const submit = async (
    participation: ContestParticipation,
    fields: { result: 'AC' | 'WA'; points: number },
    source: string,
    problem: Problem = sum,
  ) => {
    const submission = await seedContestSubmission(
      worker,
      participation,
      problem._id,
      {
        fields: { language: cpp._id, ...fields },
        points: fields.points,
      },
    );
    await worker.submissionSources.create({ _id: submission._id, source });
    return submission;
  };
  const zipPath = () => contestExportPath(worker.contestDataRoot, contest._id);
  const csvRows = async () =>
    (await readZip(zipPath()))['submissions.csv'].trim().split('\r\n').slice(1);

  beforeAll(async () => {
    worker = await setupWorkerTest({
      overrides: [{ provide: CONTEST_EXPORT_LIMITS, useValue: limits }],
    });
    service = worker.module.get(ContestExportService);
    cpp = await worker.languages.create({
      key: 'cpp',
      name: 'C++',
      commonName: 'C++',
      ace: 'text',
      pygments: 'text',
      extension: 'cpp',
    });
    for (const username of ['alice', 'bob', 'dave', 'carol', 'erin'])
      userIds[username] = (await seedUser(worker, { username }))._id;
    sum = await seedProblem(worker, { code: 'sum' });
  });
  afterAll(() => worker.teardown());
  beforeEach(async () => {
    Object.assign(limits, DEFAULT_CONTEST_EXPORT_LIMITS);
    for (const name of readdirSync(worker.contestDataRoot))
      rmSync(join(worker.contestDataRoot, name), { recursive: true });
    contest = await seedContest(worker, { problems: [entry(sum, 0)] });
  });

  it('exports each live contest submission once, with its source, and leaves virtual and spectating rows out', async () => {
    const [alice, bob, dave, carol, erin] = [
      await joinAs('alice'),
      await joinAs('bob', { isDisqualified: true }),
      await joinAs('dave', { virtual: 1 }),
      await joinAs('carol', { virtual: -1 }),
      await joinAs('erin', { isRegistered: true }),
    ];
    const wrong = await submit(
      alice,
      { result: 'WA', points: 0 },
      'int wa() {}',
    );
    const right = await submit(
      alice,
      { result: 'AC', points: 100 },
      'int ok() {}',
    );
    const flagged = await submit(
      bob,
      { result: 'AC', points: 100 },
      'int bob() {}',
    );
    await submit(dave, { result: 'AC', points: 100 }, 'int virtual() {}');
    await submit(carol, { result: 'AC', points: 100 }, 'int spectate() {}');
    void erin;
    expect(await service.prepare({ contestId: contest._id })).toBe(4);
    const files = await readZip(zipPath());
    expect(Object.keys(files).sort()).toEqual(
      [
        'submissions.csv',
        `sources/sum/${wrong._id}.cpp`,
        `sources/sum/${right._id}.cpp`,
        `sources/sum/${flagged._id}.cpp`,
      ].sort(),
    );
    expect(files[`sources/sum/${right._id}.cpp`]).toBe('int ok() {}');
    const rows = await csvRows();
    expect(rows).toHaveLength(3);
    expect(rows.filter((line) => line.startsWith(right._id)).length).toBe(1);
    expect(
      rows.find((line) => line.startsWith(flagged._id))!.endsWith(',true'),
    ).toBe(true);
    expect(
      rows.find((line) => line.startsWith(right._id))!.endsWith(',false'),
    ).toBe(true);
    expect(rows.join('\n')).not.toContain('dave');
  });

  it("keeps a deleted problem's submissions in the CSV but leaves their sources out, also after it left the contest", async () => {
    const gone = await seedProblem(worker, { code: 'gone' });
    const removed = await seedProblem(worker, { code: 'removed' });
    contest = await seedContest(worker, {
      problems: [entry(sum, 0), entry(gone, 1), entry(removed, 2)],
    });
    const alice = await joinAs('alice');
    const live = await submit(
      alice,
      { result: 'AC', points: 100 },
      'int a() {}',
    );
    const hidden = [
      await submit(alice, { result: 'AC', points: 100 }, 'int g() {}', gone),
      await submit(alice, { result: 'AC', points: 100 }, 'int r() {}', removed),
    ];
    // The delete route refuses a problem in a contest, so the usual path is: take it out, then delete it.
    await worker.contests.updateOne(
      { _id: contest._id },
      { $pull: { problems: { problem: removed._id } } },
    );
    await worker.problems.updateMany(
      { _id: { $in: [gone._id, removed._id] } },
      { $set: { deletedAt: new Date() } },
    );
    expect(await service.prepare({ contestId: contest._id })).toBe(2);
    const files = await readZip(zipPath());
    expect(Object.keys(files).sort()).toEqual(
      ['submissions.csv', `sources/sum/${live._id}.cpp`].sort(),
    );
    const rows = await csvRows();
    for (const submission of hidden)
      expect(rows.some((line) => line.startsWith(submission._id))).toBe(true);
  });

  it('names a problem taken out of the contest by its code, in the CSV and in the source path', async () => {
    const dropped = await seedProblem(worker, { code: 'dropped' });
    contest = await seedContest(worker, {
      problems: [entry(sum, 0), entry(dropped, 1)],
    });
    const alice = await joinAs('alice');
    const submission = await submit(
      alice,
      { result: 'AC', points: 100 },
      'int r() {}',
      dropped,
    );
    await worker.contests.updateOne(
      { _id: contest._id },
      { $pull: { problems: { problem: dropped._id } } },
    );
    await service.prepare({ contestId: contest._id });
    const files = await readZip(zipPath());
    expect(files[`sources/dropped/${submission._id}.cpp`]).toBe('int r() {}');
    const [row] = await csvRows();
    expect(row.split(',')[3]).toBe('dropped');
  });

  it('counts a windowed participation from its own start in contest_seconds', async () => {
    const windowed = await seedContest(worker, {
      problems: [entry(sum, 0)],
      timeLimit: 3600,
    });
    const joinedAt = new Date(windowed.startTime.getTime() + 20 * 60_000);
    const participation = await seedParticipation(
      worker,
      windowed._id,
      userIds.alice,
      { realStart: joinedAt },
    );
    await seedContestSubmission(worker, participation, sum._id, {
      fields: {
        language: cpp._id,
        date: new Date(joinedAt.getTime() + 5 * 60_000),
      },
      points: 100,
    });
    await service.prepare({ contestId: windowed._id });
    const csv = (
      await readZip(contestExportPath(worker.contestDataRoot, windowed._id))
    )['submissions.csv'];
    expect(csv.split('\r\n')[1].split(',')[6]).toBe('300');
  });

  it('exports an empty contest as a header only, and replaces the previous zip', async () => {
    await service.prepare({ contestId: contest._id });
    expect(Object.keys(await readZip(zipPath()))).toEqual(['submissions.csv']);
    const alice = await joinAs('alice');
    await submit(alice, { result: 'AC', points: 100 }, 'int a() {}');
    await service.prepare({ contestId: contest._id });
    expect(Object.keys(await readZip(zipPath()))).toHaveLength(2);
    expect(readdirSync(worker.contestDataRoot)).toEqual([
      `${contest._id}.export.zip`,
    ]);
  });

  it('aborts at the byte cap and leaves no zip, old or partial', async () => {
    const alice = await joinAs('alice');
    await submit(alice, { result: 'AC', points: 100 }, 'int a() {}');
    writeFileSync(zipPath(), 'old');
    limits.maxBytes = 10;
    await expect(service.prepare({ contestId: contest._id })).rejects.toThrow(
      ContestExportError,
    );
    expect(readdirSync(worker.contestDataRoot)).toEqual([]);
  });

  it('refuses more entries than the cap before writing anything', async () => {
    const alice = await joinAs('alice');
    await submit(alice, { result: 'AC', points: 100 }, 'int a() {}');
    limits.maxEntries = 1;
    const loadRows = jest.spyOn(
      worker.module.get(ContestExportRepository),
      'rows',
    );
    await expect(service.prepare({ contestId: contest._id })).rejects.toThrow(
      /too many/i,
    );
    expect(readdirSync(worker.contestDataRoot)).toEqual([]);
    expect(loadRows).not.toHaveBeenCalled();
  });

  it('answers 0 entries for a contest that vanished', async () => {
    expect(
      await service.prepare({
        contestId: '0192f1c2-7a3b-7c4d-8e5f-0123456789ab',
      }),
    ).toBe(0);
  });

  it('sweeps export and data zips after a week and crashed temp files after a day, and nothing else', async () => {
    const root = worker.contestDataRoot;
    const hours = (count: number) => new Date(Date.now() - count * 3_600_000);
    const fileAged = (path: string, age: Date) => {
      writeFileSync(path, 'bytes');
      utimesSync(path, age, age);
      return path;
    };
    const [weekOld, dayOld] = [hours(7 * 24 + 1), hours(25)];
    const removed = [
      fileAged(contestExportPath(root, newId()), weekOld),
      fileAged(contestDataPath(root, newId()), weekOld),
      fileAged(contestExportTempPath(root, newId(), 'run'), dayOld),
    ];
    const kept = [
      fileAged(contestExportPath(root, newId()), hours(6 * 24)),
      fileAged(contestDataTempPath(root, newId(), 'run'), hours(23)),
      fileAged(join(root, 'notes.zip'), weekOld),
      fileAged(join(root, 'readme.txt'), weekOld),
    ];
    expect(await worker.module.get(ContestZipSweepService).sweep()).toBe(3);
    expect(removed.filter((path) => existsSync(path))).toEqual([]);
    expect(kept.filter((path) => !existsSync(path))).toEqual([]);
  });
});
