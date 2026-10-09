import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { CONTEST_REPLAY_QUEUE, GHOST_CSV_MAX_BYTES } from '@libs/contests';
import type { ContestReplayJob } from '@libs/contests';
import type { User } from '@libs/database';
import type {
  GhostImportResponse,
  GhostListResponse,
} from '../src/modules/contests/ghosts/dto/ghosts.dto';
import {
  contestProblem,
  contestUrl,
  createContest,
  hoursFromNow,
  joinParticipation,
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

const CSV = [
  'label,caption,ghost_a,ghost_b',
  'Ann,School A,12+2,',
  'Bob,School B,30,45+0',
].join('\r\n');

describe('contest ghosts', () => {
  let api: ApiTest;
  const sessions: Record<string, TestSession> = {};
  const users: Record<string, { _id: string }> = {};
  const problems: Array<{ _id: string }> = [];
  const url = (key: string, suffix = '') => contestUrl(key, `/ghosts${suffix}`);
  const put = (role: string, key: string, body: Record<string, unknown>) =>
    authed(api.http().put(url(key)), sessions[role]).send(body);
  const list = async (key: string) =>
    dataOf<GhostListResponse>(
      await authed(api.http().get(url(key)), sessions.editor).expect(200),
    ).ghosts;
  const icpcContest = (extra = {}) =>
    createContest(api, {
      formatName: 'icpc',
      authors: [users.editor._id],
      problems: [
        contestProblem(problems[0]._id, 0),
        contestProblem(problems[1]._id, 1),
      ],
      ...extra,
    });

  beforeAll(async () => {
    api = await setupApiTest();
    const catalog = await seedCatalog(api);
    const roles: Array<[string, Partial<User>]> = [
      ['editor', { permissions: ['judge.edit_own_contest'] }],
      ['plain', {}],
    ];
    for (const [name, extra] of roles) {
      users[name] = await createUserWith(api, name, extra);
      sessions[name] = await loginAs(api, users[name]._id);
    }
    problems.push(
      await createProblem(api, catalog, { code: 'ghost_a' }),
      await createProblem(api, catalog, { code: 'ghost_b' }),
    );
  });
  afterAll(() => api.teardown());

  it('stores the set for editors only and lists it with the unranked flag the format derives', async () => {
    const contest = await icpcContest();
    await put('plain', contest.key, { csv: CSV }).expect(403);
    const imported = dataOf<GhostImportResponse>(
      await put('editor', contest.key, { csv: CSV }).expect(200),
    );
    expect(imported.stored).toBe(true);
    const ghosts = await list(contest.key);
    expect(
      ghosts.map((ghost) => [ghost.label, ghost.isUnranked, ghost.gap]),
    ).toEqual([
      ['Ann', false, null],
      ['Bob', true, 'rejectedBefore'],
    ]);
    expect(ghosts[0].cells).toEqual([
      { problemCode: 'ghost_a', minute: 12, rejectedBefore: 2, points: null },
    ]);
  });

  it('re-derives the flag when the format changes, because it is never stored', async () => {
    const contest = await icpcContest();
    await put('editor', contest.key, { csv: CSV }).expect(200);
    await api.contests.updateOne(
      { _id: contest._id },
      { formatName: 'default' },
    );
    expect((await list(contest.key)).map((ghost) => ghost.isUnranked)).toEqual([
      false,
      false,
    ]);
  });

  it('previews without storing on dryRun and replaces the whole set otherwise', async () => {
    const contest = await icpcContest();
    const preview = dataOf<GhostImportResponse>(
      await put('editor', contest.key, { csv: CSV, dryRun: true }).expect(200),
    );
    expect(preview.stored).toBe(false);
    expect(preview.ghosts).toHaveLength(2);
    expect(await list(contest.key)).toEqual([]);
    await put('editor', contest.key, { csv: CSV }).expect(200);
    await put('editor', contest.key, {
      csv: 'label,caption,ghost_a\r\nCy,,5+0',
    }).expect(200);
    expect((await list(contest.key)).map((ghost) => ghost.label)).toEqual([
      'Cy',
    ]);
  });

  it('reports every bad row with its number, stores nothing, and keeps the previous set', async () => {
    const contest = await icpcContest();
    await put('editor', contest.key, { csv: CSV }).expect(200);
    const bad = [
      'label,caption,ghost_a',
      '=cmd,,5+0',
      'Dee,,zzz',
      'Dee,,6+0',
    ].join('\n');
    const response = await put('editor', contest.key, { csv: bad })
      .expect(400)
      .expect(errorCode('ghost_import_invalid'));
    const messages = (response.body as { error: { fields: { csv: string[] } } })
      .error.fields.csv;
    expect(messages.join('\n')).toMatch(/Row 2: the label starts with/);
    expect(messages.join('\n')).toMatch(/Row 3: .*"zzz"/);
    expect(messages.join('\n')).toMatch(/Row 4: the label repeats/);
    expect((await list(contest.key)).map((ghost) => ghost.label)).toEqual([
      'Ann',
      'Bob',
    ]);
  });

  it('refuses a body over 1 MiB with 413 and stores nothing', async () => {
    const contest = await icpcContest();
    const huge = `label,caption,ghost_a\r\n${'x'.repeat(GHOST_CSV_MAX_BYTES)},,5`;
    await put('editor', contest.key, { csv: huge }).expect(413);
    expect(await list(contest.key)).toEqual([]);
  });

  it('anonymises labels on request', async () => {
    const contest = await icpcContest();
    await put('editor', contest.key, { csv: CSV, anonymize: true }).expect(200);
    expect(
      (await list(contest.key)).map((ghost) => [ghost.label, ghost.caption]),
    ).toEqual([
      ['Ghost 001', 'School A'],
      ['Ghost 002', 'School B'],
    ]);
  });

  it('downloads the current set as CSV that imports back to the same set', async () => {
    const contest = await icpcContest();
    await put('editor', contest.key, { csv: CSV }).expect(200);
    const download = await authed(
      api.http().get(url(contest.key, '/csv')),
      sessions.editor,
    ).expect(200);
    expect(download.headers['content-type']).toMatch(/text\/csv/);
    expect(download.headers['content-disposition']).toMatch(/attachment/);
    expect(download.headers['x-content-type-options']).toBe('nosniff');
    const before = await list(contest.key);
    await put('editor', contest.key, { csv: download.text }).expect(200);
    expect(await list(contest.key)).toEqual(before);
    await authed(
      api.http().get(url(contest.key, '/csv')),
      sessions.plain,
    ).expect(403);
  });

  it('queues one replay rebuild when the set changes in an ended contest, and none while it runs or on a dry run', async () => {
    const queue = api.app.get<Queue<ContestReplayJob>>(
      getQueueToken(CONTEST_REPLAY_QUEUE),
    );
    await queue.obliterate({ force: true });
    const waiting = () => queue.getJobs(['waiting', 'delayed']);
    const running = await icpcContest();
    await put('editor', running.key, { csv: CSV }).expect(200);
    expect(await waiting()).toHaveLength(0);
    const ended = await icpcContest({
      startTime: hoursFromNow(-5),
      endTime: hoursFromNow(-1),
    });
    await put('editor', ended.key, { csv: CSV, dryRun: true }).expect(200);
    expect(await waiting()).toHaveLength(0);
    await put('editor', ended.key, { csv: CSV }).expect(200);
    await authed(api.http().delete(url(ended.key)), sessions.editor).expect(
      204,
    );
    expect((await waiting()).map((job) => job.data.contestId)).toEqual([
      ended._id,
    ]);
  });

  it('deletes the set, refuses a final-submission contest, and never touches the ranking or ratings', async () => {
    const contest = await icpcContest();
    await joinParticipation(api, contest._id, users.plain._id, { score: 50 });
    await put('editor', contest.key, { csv: CSV }).expect(200);
    const board = await api
      .http()
      .get(contestUrl(contest.key, '/ranking'))
      .expect(200);
    expect(JSON.stringify(board.body)).not.toContain('Ann');
    expect(await api.ratings.countDocuments({ contest: contest._id })).toBe(0);
    await authed(api.http().delete(url(contest.key)), sessions.plain).expect(
      403,
    );
    await authed(api.http().delete(url(contest.key)), sessions.editor).expect(
      204,
    );
    expect(await list(contest.key)).toEqual([]);
    const fso = await icpcContest({ formatName: 'final_submission' });
    await put('editor', fso.key, { csv: CSV })
      .expect(409)
      .expect(errorCode('ghost_unsupported_format'));
  });
});
