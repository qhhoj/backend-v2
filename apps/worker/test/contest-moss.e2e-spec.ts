import { getQueueToken } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { waitUntil } from '@libs/common/testing';
import {
  CONTEST_MOSS_JOB,
  CONTEST_MOSS_QUEUE,
  mossJobId,
  SPECTATE,
  oneJobPerContest,
} from '@libs/contests';
import type { ContestMossJob } from '@libs/contests';
import type { Contest, Language, Problem } from '@libs/database';
import { ContestMossService } from '../src/jobs/contest-moss/contest-moss.service';
import { MOSS_SERVER } from '../src/jobs/contest-moss/moss-client';
import type { MossServer } from '../src/jobs/contest-moss/moss-client';
import {
  seedContest,
  seedContestSubmission,
  seedParticipation,
  seedProblem,
  seedUser,
} from './effects-fixtures';
import { startFakeMoss } from './fake-moss';
import { setupWorkerTest } from './setup';
import type { WorkerTest } from './setup';

const RESULT_URL = 'http://moss.stanford.edu/results/1/2345';
const VIRTUAL = 1;

describe('contest MOSS', () => {
  let worker: WorkerTest;
  let moss: Awaited<ReturnType<typeof startFakeMoss>>;
  let silent: Awaited<ReturnType<typeof startFakeMoss>>;
  let service: ContestMossService;
  let cpp: Language;
  let python: Language;
  let problems: Problem[];
  let contest: Contest;
  const server: MossServer = {
    host: '127.0.0.1',
    port: 0,
    timeoutMs: 2000,
    batchTimeoutMs: 5000,
  };
  const queueOf = () =>
    worker.module.get<Queue<ContestMossJob>>(getQueueToken(CONTEST_MOSS_QUEUE));
  const contestProblem = (problem: Problem, order: number) => ({
    problem: problem._id,
    points: 100,
    partial: true,
    isPretested: false,
    order,
    outputPrefixOverride: null,
    maxSubmissions: null,
  });
  const join = async (username: string, virtual: number) =>
    seedParticipation(
      worker,
      contest._id,
      (await seedUser(worker, { username }))._id,
      { virtual },
    );
  /** A graded submission of the participation on the first problem. */
  const submit = async (
    participation: Awaited<ReturnType<typeof join>>,
    language: Language,
    fields: Record<string, unknown>,
    source: string,
  ) => {
    const submission = await seedContestSubmission(
      worker,
      participation,
      problems[0]._id,
      {
        language: language._id,
        ...fields,
      },
    );
    await worker.submissionSources.create({ _id: submission._id, source });
    return submission;
  };
  /** One passing C++ submission of a new live user. */
  const submitOne = async (username: string) =>
    submit(await join(username, 0), cpp, {}, 'int main() {}');

  beforeAll(async () => {
    moss = await startFakeMoss(() => RESULT_URL);
    silent = await startFakeMoss(() => null);
    worker = await setupWorkerTest({
      env: { MOSS_API_KEY: 'test-moss-key' },
      overrides: [{ provide: MOSS_SERVER, useValue: server }],
    });
    service = worker.module.get(ContestMossService);
    const language = (key: string, commonName: string) =>
      worker.languages.create({
        key,
        name: commonName,
        commonName,
        ace: 'text',
        pygments: 'text',
        extension: key,
      });
    cpp = await language('cpp', 'C++');
    python = await language('py', 'Python');
    problems = [await seedProblem(worker), await seedProblem(worker)];
  });
  afterAll(async () => {
    await worker.teardown();
    await Promise.all([moss.close(), silent.close()]);
  });
  beforeEach(async () => {
    moss.sessions.length = 0;
    server.port = moss.port;
    await worker.contestMoss.deleteMany({});
    contest = await seedContest(worker, {
      problems: problems.map(contestProblem),
    });
    await queueOf().obliterate({ force: true });
  });
  afterEach(() => jest.restoreAllMocks());

  it('sends each user best qualifying source per problem and language and stores the URLs', async () => {
    const [alice, bob] = [await join('alice', 0), await join('bob', 0)];
    await submit(alice, cpp, { points: 30, result: 'WA' }, 'int worse() {}');
    const aliceBest = await submit(
      alice,
      cpp,
      { points: 100 },
      'int best() {}',
    );
    await submit(
      bob,
      cpp,
      { result: 'WA', casePoints: 0, points: 0 },
      'int zero() {}',
    );
    await submit(
      bob,
      cpp,
      { result: 'CE', casePoints: 5, points: 0 },
      'int broken(',
    );
    await submit(await join('carol', SPECTATE), python, {}, 'print(1)');
    await submit(await join('dave', VIRTUAL), cpp, {}, 'int virtual_run() {}');

    expect(await service.run(contest._id)).toBe(10);

    const sent = moss.sessions.map((session) => [
      session.commands.find((command) => command.startsWith('language')),
      session.files.map((file) => file.name),
    ]);
    expect(sent).toEqual([
      ['language cc', ['alice']],
      ['language python', ['carol']],
    ]);
    expect(moss.sessions[0].files[0].content).toBe(
      `// http://localhost:5173/submission/${aliceBest._id}\nint best() {}`,
    );
    const rows = await worker.contestMoss.find({ contest: contest._id }).lean();
    expect(rows).toHaveLength(5 * problems.length);
    expect(
      rows
        .filter((row) => row.url)
        .map((row) => [row.language, row.submissionCount, row.url]),
    ).toEqual(
      expect.arrayContaining([
        ['C++', 1, RESULT_URL],
        ['Python', 1, RESULT_URL],
      ]),
    );
    expect(
      rows.filter((row) => !row.url).every((row) => row.submissionCount === 0),
    ).toBe(true);
  });

  it('replaces the previous results of the contest on success', async () => {
    await worker.contestMoss.create({
      contest: contest._id,
      problem: problems[1]._id,
      language: 'Java',
      submissionCount: 7,
      url: 'http://moss.stanford.edu/results/1/old',
    });
    await submitOne('erin');
    await service.run(contest._id);
    const rows = await worker.contestMoss.find({ contest: contest._id }).lean();
    expect(rows.some((row) => row.url?.endsWith('/old'))).toBe(false);
    expect(rows).toHaveLength(5 * problems.length);
  });

  it('names files after sanitised usernames', async () => {
    await submitOne('odd name/é');
    await service.run(contest._id);
    expect(moss.sessions[0].files.map((file) => file.name)).toEqual([
      'odd_name__',
    ]);
  });

  it('fails after the timeout against a silent server, keeps earlier results and never logs the key', async () => {
    const logged = [
      jest.spyOn(Logger.prototype, 'error'),
      jest.spyOn(Logger.prototype, 'warn'),
      jest.spyOn(Logger.prototype, 'log'),
    ];
    await worker.contestMoss.create({
      contest: contest._id,
      problem: problems[0]._id,
      language: 'C++',
      submissionCount: 2,
      url: 'http://moss.stanford.edu/results/1/old',
    });
    await submitOne('frank');
    server.port = silent.port;
    server.timeoutMs = 200;
    try {
      await queueOf().add(
        CONTEST_MOSS_JOB,
        { contestId: contest._id },
        oneJobPerContest('moss', contest._id),
      );
      await waitUntil(
        async () => !(await queueOf().getJob(mossJobId(contest._id))),
        5000,
      );
    } finally {
      server.timeoutMs = 2000;
    }
    expect(
      (await worker.contestMoss.find({ contest: contest._id }).lean()).map(
        (row) => row.url,
      ),
    ).toEqual(['http://moss.stanford.edu/results/1/old']);
    const messages = logged.flatMap((spy) => spy.mock.calls.flat().map(String));
    expect(messages.some((message) => message.includes('MOSS timed out'))).toBe(
      true,
    );
    expect(messages.some((message) => message.includes('test-moss-key'))).toBe(
      false,
    );
  });
});
