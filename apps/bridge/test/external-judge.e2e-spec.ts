import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { ExternalRun } from '@libs/database';
import { EXTERNAL_JUDGE_NAME } from '@libs/judging';
import { SettingsService } from '@libs/settings';
import { CommandsService } from '../src/dispatch/commands.service';
import {
  TIMED_OUT_MESSAGE,
  UNMAPPED_LANGUAGE_MESSAGE,
} from '../src/external/external-runner.service';
import { SubmissionsRepository } from '../src/submissions/submissions.repository';
import {
  seedCatalog,
  seedProblem,
  seedSubmission,
  waitUntil,
} from './fixtures';
import type { BridgeCatalog } from './fixtures';
import { setupBridgeTest } from './setup';
import type { BridgeTest } from './setup';

const BASE_URL = 'https://pcd.test';
const TOKEN = 'pcd-token';
const PROCESSING = { systemStatus: 'polling', processing: true };
const done = (fields: Record<string, unknown>) => ({
  systemStatus: 'done',
  processing: false,
  ...fields,
});

/** A PCD VJudge: numbered remote ids, and per remote id the status answers to give in turn (the last one repeats). */
class FakePcd {
  submits: Record<string, unknown>[] = [];
  answers = new Map<string, Response[]>();
  /** Status answers for the next remote id, as HTTP status + body. */
  script: [number, unknown][] = [[200, done({ statusCanonical: 'AC' })]];
  /** HTTP status of the next submits (200 by default). */
  submitStatus = 200;

  readonly fetch = (
    input: URL | string,
    init?: RequestInit,
  ): Promise<Response> => Promise.resolve(this.answer(input, init));

  private answer(input: URL | string, init?: RequestInit): Response {
    const url = new URL(String(input));
    if (!url.href.startsWith(BASE_URL))
      throw new Error(`unexpected ${url.href}`);
    if (init?.method === 'POST') return this.submit(init);
    const remoteId = /submissions\/([^/]+)\/status$/.exec(url.pathname)?.[1];
    const queue = this.answers.get(remoteId ?? '') ?? [];
    return (
      (queue.length > 1 ? queue.shift() : queue[0]?.clone()) ?? json(404, {})
    );
  }

  private submit(init: RequestInit): Response {
    if (this.submitStatus !== 200) return json(this.submitStatus, {});
    this.submits.push(
      JSON.parse(init.body as string) as Record<string, unknown>,
    );
    const remoteId = `r-${this.submits.length}`;
    this.answers.set(
      remoteId,
      this.script.map(([status, body]) => json(status, body)),
    );
    return json(200, {
      data: { submissionId: remoteId, systemStatus: 'queued' },
    });
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('External judge adapter (bridge)', () => {
  let bridge: BridgeTest;
  let catalog: BridgeCatalog;
  let pcd: FakePcd;
  let codes = 0;
  const realFetch = global.fetch;
  const settings = () => bridge.module.get(SettingsService);
  const externalRuns = () =>
    bridge.module.get<Model<ExternalRun>>(getModelToken(ExternalRun.name));
  const stored = async (id: string) =>
    (await bridge.submissions.findById(id).select('+cases').lean())!;
  const finished = (id: string) =>
    waitUntil(async () =>
      ['D', 'CE', 'IE', 'AB'].includes((await stored(id)).status),
    );

  /** A problem the external judge takes, C++17 mapped to remote `cpp17`; Python is allowed but not mapped. */
  const externalProblem = (fields: { partial?: boolean } = {}) =>
    seedProblem(bridge, catalog, {
      code: `ext${(codes += 1)}`,
      points: 1000,
      partial: fields.partial ?? false,
      externalJudge: {
        isActive: true,
        oj: 'CodeForces',
        problemId: '490B',
        title: 'Queue',
        languages: [
          { language: catalog.cpp._id, remoteId: 'cpp17', remoteName: 'C++17' },
        ],
        verifiedAt: null,
      },
    });
  const submitTo = async (
    problem: { _id: string },
    fields: { language?: string } = {},
  ) =>
    (await seedSubmission(bridge, catalog, { problem: problem._id, ...fields }))
      ._id;

  beforeAll(async () => {
    pcd = new FakePcd();
    global.fetch = pcd.fetch;
    bridge = await setupBridgeTest();
    catalog = await seedCatalog(bridge);
    await settings().set('externalJudge.baseUrl', BASE_URL, null);
    await settings().set('externalJudge.apiToken', TOKEN, null);
  });
  beforeEach(async () => {
    pcd.submits = [];
    pcd.script = [[200, done({ statusCanonical: 'AC' })]];
    pcd.submitStatus = 200;
    await settings().set('externalJudge.maxInFlight', 5, null);
    await bridge.graded.obliterate({ force: true });
  });
  afterAll(async () => {
    await bridge.teardown();
    global.fetch = realFetch;
  });

  it('routes only external problems to the adapter, and only normal ones to judges', async () => {
    const normal = await seedProblem(bridge, catalog, {
      code: `plain${(codes += 1)}`,
    });
    const external = await externalProblem();
    pcd.script = [[200, PROCESSING]];
    const normalId = await submitTo(normal);
    const externalId = await submitTo(external);
    const repository = bridge.module.get(SubmissionsRepository);
    const forJudges = await repository.loadQueued([normalId, externalId]);
    expect(forJudges.map((row) => row.id)).toEqual([normalId]);
    await waitUntil(async () => (await stored(externalId)).status === 'G');
    expect((await stored(normalId)).status).toBe('QU');
    expect((await stored(externalId)).judgedOn).toBe(EXTERNAL_JUDGE_NAME);
    expect(pcd.submits).toEqual([
      {
        oj: 'CodeForces',
        problemId: '490B',
        language: 'cpp17',
        source: 'int main() {}',
        open: true,
      },
    ]);
    // the resync never treats the adapter's run as stranded
    expect(
      (await repository.inFlightRuns()).map((run) => run.id),
    ).not.toContain(externalId);
    await bridge.submissions.updateOne({ _id: externalId }, { status: 'AB' });
  });

  it('grades an accepted remote run as one full-marks case and enqueues the graded job', async () => {
    const id = await submitTo(await externalProblem());
    await finished(id);
    const row = await stored(id);
    expect(row).toMatchObject({
      status: 'D',
      result: 'AC',
      points: 1000,
      casePoints: 100,
      caseTotal: 100,
    });
    expect(row.cases).toHaveLength(1);
    await waitUntil(async () =>
      (await bridge.gradedJobs()).some((job) => job.submissionId === id),
    );
  });

  it('gives proportional points on a partial problem and keeps polling while the remote judges', async () => {
    pcd.script = [
      [200, PROCESSING],
      [
        200,
        done({
          statusCanonical: 'WA',
          scoreText: '30/40',
          runtimeMs: 250,
          memoryKb: 512,
        }),
      ],
    ];
    const id = await submitTo(await externalProblem({ partial: true }));
    await finished(id);
    expect(await stored(id)).toMatchObject({
      status: 'D',
      result: 'WA',
      points: 750,
      time: 0.25,
      memory: 512,
    });
  });

  it('ends a remote compile error as CE with its log', async () => {
    pcd.script = [
      [200, done({ statusCanonical: 'CE', errorMessage: 'error: expected ;' })],
    ];
    const id = await submitTo(await externalProblem());
    await finished(id);
    expect(await stored(id)).toMatchObject({
      status: 'CE',
      result: 'CE',
      error: 'error: expected ;',
    });
  });

  it('refuses a language with no remote mapping as CE without calling the external judge', async () => {
    const id = await submitTo(await externalProblem(), {
      language: catalog.python._id,
    });
    await finished(id);
    expect(await stored(id)).toMatchObject({
      status: 'CE',
      error: UNMAPPED_LANGUAGE_MESSAGE('PY3'),
    });
    expect(pcd.submits).toEqual([]);
  });

  it('ends a refused submit as IE', async () => {
    pcd.submitStatus = 401;
    const id = await submitTo(await externalProblem());
    await finished(id);
    expect(await stored(id)).toMatchObject({
      status: 'IE',
      error: 'The external judge refused the API token',
    });
  });

  it('retries a transient poll failure with backoff, and ends a non-transient one as IE', async () => {
    pcd.script = [
      [503, {}],
      [200, done({ statusCanonical: 'AC' })],
    ];
    const retried = await submitTo(await externalProblem());
    await finished(retried);
    expect((await stored(retried)).result).toBe('AC');

    pcd.script = [[401, {}]];
    const refused = await submitTo(await externalProblem());
    await finished(refused);
    expect(await stored(refused)).toMatchObject({
      status: 'IE',
      error: 'The external judge refused the API token',
    });
  });

  it('gives up as IE once maxWaitMinutes passed since the submit', async () => {
    pcd.script = [[200, PROCESSING]];
    const id = await submitTo(await externalProblem());
    await waitUntil(async () => (await stored(id)).status === 'G');
    await externalRuns().updateOne(
      { _id: id },
      { submittedAt: new Date(Date.now() - 31 * 60_000) },
    );
    await finished(id);
    expect(await stored(id)).toMatchObject({
      status: 'IE',
      error: TIMED_OUT_MESSAGE(30),
    });
  });

  it('keeps at most maxInFlight runs on the remote judge', async () => {
    await settings().set('externalJudge.maxInFlight', 1, null);
    pcd.script = [[200, PROCESSING]];
    const problem = await externalProblem();
    const first = await submitTo(problem);
    const second = await submitTo(problem);
    await waitUntil(async () => (await stored(first)).status === 'G');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await stored(second)).status).toBe('QU');
    expect(pcd.submits).toHaveLength(1);
    await bridge.submissions.updateMany(
      { _id: { $in: [first, second] } },
      { status: 'AB' },
    );
  });

  it('requeues once a run the bridge held with no remote id (restart between claim and submit), then submits it', async () => {
    const id = await submitTo(await externalProblem());
    // as a bridge that died right after its claim leaves it
    await bridge.submissions.updateOne(
      { _id: id, status: 'QU' },
      {
        status: 'P',
        judgedOn: EXTERNAL_JUDGE_NAME,
        judgeGeneration: 1,
        judgeSeq: 0,
      },
    );
    await finished(id);
    expect(await stored(id)).toMatchObject({
      status: 'D',
      result: 'AC',
      requeueCount: 1,
      judgeGeneration: 2,
    });
    expect(pcd.submits).toHaveLength(1);
  });

  it('drops the old run on a rejudge: the new generation is submitted again and its answer counts', async () => {
    pcd.script = [[200, PROCESSING]];
    const id = await submitTo(await externalProblem());
    await waitUntil(async () => (await stored(id)).status === 'G');
    pcd.script = [[200, done({ statusCanonical: 'WA' })]];
    // what a rejudge writes, then its command
    await bridge.submissions.updateOne(
      { _id: id },
      { status: 'QU', judgedOn: null, judgeSeq: 0 },
    );
    await bridge.module.get(CommandsService).apply(
      JSON.stringify({
        type: 'judge',
        submissionIds: [id],
        judgeName: null,
        bannedJudges: [],
      }),
    );
    await finished(id);
    expect(await stored(id)).toMatchObject({
      status: 'D',
      result: 'WA',
      judgeGeneration: 2,
    });
    expect(pcd.submits).toHaveLength(2);
    expect((await externalRuns().findById(id).lean())?.remoteId).toBe(
      `r-${pcd.submits.length}`,
    );
  });

  it('ends an aborted run as AB and stops polling it', async () => {
    pcd.script = [[200, PROCESSING]];
    const id = await submitTo(await externalProblem());
    await waitUntil(async () => (await stored(id)).status === 'G');
    await bridge.module
      .get(CommandsService)
      .apply(JSON.stringify({ type: 'abort', submissionId: id }));
    await finished(id);
    expect(await stored(id)).toMatchObject({
      status: 'AB',
      result: 'AB',
      points: 0,
    });
  });
});
