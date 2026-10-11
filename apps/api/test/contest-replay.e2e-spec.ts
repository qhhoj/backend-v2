import { getQueueToken } from '@nestjs/bullmq';

import { Queue } from 'bullmq';

import { CONTEST_REPLAY_QUEUE, REPLAY_FORMAT_VERSION } from '@libs/contests';

import type { ContestReplayJob } from '@libs/contests';

import { newId, uuidStr } from '@libs/database';

import type { Contest, User } from '@libs/database';

import type { ReplayResponse } from '../src/modules/contests/replay/dto/replay.dto';

import {
  clearRateLimits,
  contestProblem,
  contestUrl,
  createContest,
  hoursFromNow,
} from './contest-fixtures';

import {
  authed,
  createProblem,
  createUserWith,
  loginAs,
  seedCatalog,
} from './problem-fixtures';

import type { TestSession } from './problem-fixtures';

import { dataOf } from './submission-fixtures';

import { errorCode, setupApiTest } from './setup';

import type { ApiTest } from './setup';

const MINUTE = 60_000;
/** After the end plus the settle time of every contest `endedContest` makes (it ended an hour ago). */
const BUILT_AT = new Date(Date.now() - MINUTE);

interface SeedGhost {
  label: string;
  caption?: string;
  isUnranked?: boolean;
  gap?: 'points' | 'rejectedBefore' | null;
}
interface SeedOptions {
  chunks?: unknown[][][];
  ghosts?: SeedGhost[];
  ghostChunks?: unknown[][][];
  formatVersion?: number;
  builtAt?: Date;
}

describe('contest replay', () => {
  let api: ApiTest;
  let queue: Queue<ContestReplayJob>;
  const sessions: Record<string, TestSession> = {};
  const users: Record<string, { _id: string }> = {};
  let problem: { _id: string };
  const cell = { time: 720, points: 100, tries: 3 };
  const url = (key: string, query = '') => contestUrl(key, `/replay${query}`);
  const get = (key: string, who?: string, query = '') => {
    const request = api.http().get(url(key, query));
    return who ? authed(request, sessions[who]) : request;
  };
  const endedContest = (extra: Partial<Contest> = {}) =>
    createContest(api, {
      startTime: hoursFromNow(-5),
      endTime: hoursFromNow(-1),
      authors: [users.editor._id],
      problems: [contestProblem(problem._id, 0)],
      ...extra,
    });
  /** A stored build: one participant (bob), the given `real` chunks and `ghost` chunks. */
  const seedBuild = async (
    contest: Contest,
    {
      chunks = [[[720, 0, 0, cell, 100, 12, 12]]],
      ghosts = [],
      ghostChunks = [],
      formatVersion = REPLAY_FORMAT_VERSION,
      builtAt = BUILT_AT,
    }: SeedOptions = {},
  ) => {
    const buildId = newId();
    for (const [chunk, events] of chunks.entries())
      await api.replayChunks.create({
        contest: contest._id,
        buildId,
        stream: 'real',
        chunk,
        events,
      });
    for (const [chunk, events] of ghostChunks.entries())
      await api.replayChunks.create({
        contest: contest._id,
        buildId,
        stream: 'ghost',
        chunk,
        events,
      });
    await api.replayHeads.create({
      _id: contest._id,
      buildId,
      builtAt,
      formatVersion,
      chunkCount: chunks.length,
      ghostChunkCount: ghostChunks.length,
      participants: [{ participationId: newId(), userId: users.bob._id }],
      problems: [{ problemId: problem._id, points: 100 }],
      ghosts: ghosts.map((ghost) => ({
        caption: '',
        isUnranked: false,
        gap: null,
        ...ghost,
      })),
    });
    return uuidStr(buildId);
  };
  const read = async (key: string, who?: string, query = '') =>
    dataOf<ReplayResponse>(await get(key, who, query).expect(200));
  const waitingJobs = async () =>
    (await queue.getJobs(['waiting', 'delayed', 'active'])).length;

  beforeAll(async () => {
    api = await setupApiTest();
    queue = api.app.get(getQueueToken(CONTEST_REPLAY_QUEUE));
    const catalog = await seedCatalog(api);
    const roles: Array<[string, Partial<User>]> = [
      ['alice', {}],
      ['bob', {}],
      ['editor', { permissions: ['judge.edit_own_contest'] }],
    ];
    for (const [name, extra] of roles) {
      users[name] = await createUserWith(api, name, extra);
      sessions[name] = await loginAs(api, users[name]._id);
    }
    problem = await createProblem(api, catalog, { code: 'replay_a' });
  });
  afterAll(() => api.teardown());
  beforeEach(async () => {
    await queue.obliterate({ force: true });
    await clearRateLimits(api);
  });

  it('serves the first chunk with its build id, participants, problems and the stored ghosts to anyone who can read the ended board', async () => {
    const contest = await endedContest({ formatName: 'icpc' });
    const buildId = await seedBuild(contest, {
      ghosts: [
        { label: 'Ann', caption: 'School' },
        { label: 'Zed', isUnranked: true, gap: 'rejectedBefore' },
      ],
      ghostChunks: [[[720, 0, 0, cell, 100, 52, 12]]],
    });
    const body = await read(contest.key);
    expect(body).toMatchObject({
      state: 'ready',
      buildId,
      chunk: 0,
      chunkCount: 1,
      builtAt: BUILT_AT.toISOString(),
    });
    expect(body.events).toEqual([[720, 0, 0, cell, 100, 12, 12]]);
    expect(
      body.participants!.map((participant) => participant.user.username),
    ).toEqual(['bob']);
    expect(body.problems).toMatchObject([
      { code: 'replay_a', label: '1', points: 100 },
    ]);
    expect(
      body.ghosts!.map((ghost) => [
        ghost.label,
        ghost.isUnranked,
        ghost.events.length,
      ]),
    ).toEqual([
      ['Ann', false, 1],
      ['Zed', true, 0],
    ]);
    expect(body.ghosts![0].events[0].slice(0, 3)).toEqual([720, 0, 0]);
    expect(body.ghosts![0].events[0].slice(4)).toEqual([100, 52, 12]);
  });

  it('sends only events for later chunks, pinned to the build, with a private cache header', async () => {
    const contest = await endedContest();
    await seedBuild(contest, {
      chunks: [[[1, 0, 0, cell, 1, 1, 1]], [[2, 0, 0, cell, 2, 2, 2]]],
    });
    const { buildId } = await read(contest.key);
    const response = await get(
      contest.key,
      undefined,
      `?chunk=1&build=${buildId}`,
    ).expect(200);
    expect(response.headers['cache-control']).toBe('private, max-age=60');
    const body = dataOf<ReplayResponse>(response);
    expect(body).toMatchObject({
      buildId,
      chunk: 1,
      chunkCount: 2,
      participants: null,
      problems: null,
      ghosts: null,
    });
    expect(body.events[0][0]).toBe(2);
  });

  it('tells a reader that straddles a rebuild to start over, and one that sends no build to send it', async () => {
    const contest = await endedContest();
    await seedBuild(contest, {
      chunks: [[[1, 0, 0, cell, 1, 1, 1]], [[2, 0, 0, cell, 2, 2, 2]]],
    });
    const first = await read(contest.key);
    await api.replayHeads.deleteOne({ _id: contest._id });
    await seedBuild(contest, {
      chunks: [[[1, 0, 0, cell, 1, 1, 1]], [[9, 0, 0, cell, 9, 9, 9]]],
    });
    await get(contest.key, 'alice', `?chunk=1&build=${first.buildId}`)
      .expect(409)
      .expect(errorCode('replay_changed'));
    await get(contest.key, 'alice', '?chunk=1')
      .expect(400)
      .expect(errorCode('replay_build_required'));
    const second = await read(contest.key);
    expect(second.buildId).not.toBe(first.buildId);
    expect(
      (await read(contest.key, undefined, `?chunk=1&build=${second.buildId}`))
        .events[0][0],
    ).toBe(9);
  });

  it('refuses an ended but still frozen contest to a non-editor, ghosts included, and serves its editor', async () => {
    const contest = await endedContest({
      formatName: 'icpc',
      frozenLastMinutes: 30,
    });
    await seedBuild(contest, { ghosts: [{ label: 'LeakyGhost' }] });
    await get(contest.key).expect(403);
    const refused = await get(contest.key, 'alice').expect(403);
    expect(JSON.stringify(refused.body)).not.toContain('LeakyGhost');
    expect(
      (await read(contest.key, 'editor')).ghosts!.map((ghost) => ghost.label),
    ).toEqual(['LeakyGhost']);
    await api.contests.updateOne(
      { _id: contest._id },
      { frozenLastMinutes: 0 },
    );
    expect((await read(contest.key, 'alice')).state).toBe('ready');
  });

  it('answers 202 and queues exactly one build when none is stored, then when the stored one has an old format version', async () => {
    const contest = await endedContest();
    expect(
      (
        (await api.http().get(url(contest.key)).expect(202)).body as {
          data: unknown;
        }
      ).data,
    ).toMatchObject({ state: 'building', events: [] });
    await get(contest.key, 'alice').expect(202);
    expect(await waitingJobs()).toBe(1);
    await queue.obliterate({ force: true });
    await clearRateLimits(api);
    await seedBuild(contest, { formatVersion: REPLAY_FORMAT_VERSION + 1 });
    await get(contest.key, 'alice').expect(202);
    expect(await waitingJobs()).toBe(1);
  });

  it('does not pile up builds under polling: one while a build waits, one per 30 seconds otherwise', async () => {
    const contest = await endedContest();
    for (let poll = 0; poll < 10; poll += 1) await get(contest.key).expect(202);
    expect(await waitingJobs()).toBe(1);
    await clearRateLimits(api);
    await get(contest.key).expect(202);
    expect(await waitingJobs()).toBe(1);
    await queue.obliterate({ force: true });
    await get(contest.key).expect(202);
    expect(await waitingJobs()).toBe(0);
    await clearRateLimits(api);
    await get(contest.key).expect(202);
    expect(await waitingJobs()).toBe(1);
  });

  it('never serves a head built before the end plus the settle time: 202 and one delayed build', async () => {
    const endTime = new Date(Date.now() - 2 * MINUTE);
    const contest = await endedContest({ endTime });
    await seedBuild(contest, { builtAt: new Date(endTime.getTime() - MINUTE) });
    const answer = await get(contest.key, 'alice').expect(202);
    expect((answer.body as { data: unknown }).data).toMatchObject({
      state: 'building',
      events: [],
      participants: null,
    });
    const jobs = await queue.getJobs(['delayed']);
    expect(jobs.map((job) => job.data.contestId)).toEqual([contest._id]);
    expect(jobs[0].opts.delay).toBeGreaterThan(7 * MINUTE);
    expect(jobs[0].opts.delay).toBeLessThanOrEqual(8 * MINUTE);
  });

  it('answers 404 for a chunk beyond the build and 409 when a stored chunk vanished under the head', async () => {
    const contest = await endedContest();
    await seedBuild(contest);
    const { buildId } = await read(contest.key);
    await get(contest.key, 'alice', `?chunk=1&build=${buildId}`)
      .expect(404)
      .expect(errorCode('replay_chunk_not_found'));
    await api.replayChunks.deleteMany({ contest: contest._id });
    await get(contest.key, 'alice')
      .expect(409)
      .expect(errorCode('replay_changed'));
  });

  it("gives the editor's budget back when a build that has not started yet already covers the request", async () => {
    const contest = await endedContest();
    await queue.add('build', { contestId: contest._id });
    for (let attempt = 0; attempt < 5; attempt += 1)
      await authed(
        api.http().post(url(contest.key, '/rebuild')),
        sessions.editor,
      ).expect(202);
    expect(await waitingJobs()).toBe(1);
  });

  it('moves a build queued for the old end forward when the contest was ended early, for the editor and for readers', async () => {
    const contest = await endedContest();
    // A rescore at hour 1 of a 5-hour contest queued a build for its old end plus the settle time.
    await queue.add(
      'build',
      { contestId: contest._id },
      { delay: 3 * 3_600_000 },
    );
    await authed(
      api.http().post(url(contest.key, '/rebuild')),
      sessions.editor,
    ).expect(202);
    const jobs = await queue.getJobs(['waiting', 'delayed']);
    expect(jobs.map((job) => [job.data.contestId, job.opts.delay])).toEqual([
      [contest._id, 0],
    ]);
    const other = await endedContest();
    await queue.add(
      'build',
      { contestId: other._id },
      { delay: 3 * 3_600_000 },
    );
    await get(other.key, 'alice').expect(202);
    const moved = (await queue.getJobs(['waiting', 'delayed'])).filter(
      (job) => job.data.contestId === other._id,
    );
    expect(moved.map((job) => job.opts.delay)).toEqual([0]);
  });

  /** `error.issues[].code` of a refusal. */
  const issueCodes = (body: unknown): string[] =>
    (body as { error: { issues: Array<{ code: string }> } }).error.issues.map(
      (issue) => issue.code,
    );

  it('gives every refusal a stable issue code next to the error code', async () => {
    const frozen = await endedContest({
      formatName: 'icpc',
      frozenLastMinutes: 30,
    });
    const hidden = await endedContest({ scoreboardVisibility: 'H' });
    const running = await createContest(api, {
      authors: [users.editor._id],
      problems: [contestProblem(problem._id, 0)],
    });
    const fso = await endedContest({ formatName: 'final_submission' });
    const settled = await endedContest();
    await seedBuild(settled);
    const { buildId } = await read(settled.key);
    const refusals: Array<[Promise<{ body: unknown }>, string]> = [
      [get(frozen.key, 'alice').expect(403), 'board_frozen'],
      [get(hidden.key, 'alice').expect(403), 'board_hidden'],
      [get(running.key, 'alice').expect(409), 'contest_not_ended'],
      [get(fso.key, 'alice').expect(409), 'replay_unsupported'],
      [get('no_such_contest', 'alice').expect(404), 'not_found'],
      [
        get(settled.key, 'alice', '?chunk=1').expect(400),
        'replay_build_required',
      ],
      [
        get(settled.key, 'alice', `?chunk=1&build=${newId()}`).expect(409),
        'replay_changed',
      ],
      [
        get(settled.key, 'alice', `?chunk=5&build=${buildId}`).expect(404),
        'replay_chunk_not_found',
      ],
      [
        authed(
          api.http().post(url(settled.key, '/rebuild')),
          sessions.alice,
        ).expect(403),
        'forbidden',
      ],
      [
        authed(
          api.http().post(url(running.key, '/rebuild')),
          sessions.editor,
        ).expect(409),
        'contest_not_ended',
      ],
    ];
    for (const [pending, code] of refusals)
      expect(issueCodes((await pending).body)).toEqual([code]);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await authed(
        api.http().post(url(settled.key, '/rebuild')),
        sessions.editor,
      ).expect(202);
      await queue.obliterate({ force: true });
    }
    const limited = await authed(
      api.http().post(url(settled.key, '/rebuild')),
      sessions.editor,
    ).expect(429);
    expect(issueCodes(limited.body)).toEqual(['rate_limited']);
    expect(limited.headers['retry-after']).toBeDefined();
  });

  it('never reveals frozen results before the thaw: not to anonymous, a participant or a stranger, at any chunk', async () => {
    const contest = await endedContest({
      formatName: 'icpc',
      frozenLastMinutes: 30,
    });
    const buildId = await seedBuild(contest, {
      chunks: [[[1, 0, 0, cell, 1, 1, 1]], [[2, 0, 0, cell, 2, 2, 2]]],
      ghosts: [{ label: 'LeakyGhost' }],
    });
    for (const who of [undefined, 'alice', 'bob'])
      for (const query of ['', `?chunk=1&build=${buildId}`]) {
        const refused = await get(contest.key, who, query).expect(403);
        expect(JSON.stringify(refused.body)).not.toMatch(
          /LeakyGhost|"events"|"participants"/,
        );
      }
    expect(await waitingJobs()).toBe(0);
    expect(
      (await read(contest.key, 'editor', `?chunk=1&build=${buildId}`)).events,
    ).toHaveLength(1);
    await api.contests.updateOne(
      { _id: contest._id },
      { frozenLastMinutes: 0 },
    );
    for (const who of [undefined, 'alice', 'bob'])
      expect((await read(contest.key, who)).state).toBe('ready');
  });
});
