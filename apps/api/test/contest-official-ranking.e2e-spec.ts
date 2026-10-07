import type { User } from '@libs/database';
import type { OfficialRankingResponse } from '../src/modules/contests/ranking/dto/official-ranking.dto';
import { contestUrl, createContest } from './contest-fixtures';
import { authed, createUserWith, loginAs } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';

const CSV = [
  'Username,Full Name,School,Points,A,B',
  'ann,Ann,X,50,50,',
  'bob,"Bob, Jr.",Y,150,100,50',
].join('\r\n');

describe('contest official ranking', () => {
  let api: ApiTest;
  const sessions: Record<string, TestSession> = {};
  const users: Record<string, { _id: string }> = {};
  const put = (role: string, key: string, body: Record<string, unknown>) =>
    authed(
      api.http().put(contestUrl(key, '/official-ranking')),
      sessions[role],
    ).send(body);
  const show = async (key: string) =>
    dataOf<OfficialRankingResponse>(
      await api.http().get(contestUrl(key, '/official-ranking')).expect(200),
    );

  beforeAll(async () => {
    api = await setupApiTest();
    const roles: Array<[string, Partial<User>]> = [
      ['editor', { permissions: ['judge.edit_own_contest'] }],
      ['plain', {}],
    ];
    for (const [name, extra] of roles) {
      users[name] = await createUserWith(api, name, extra);
      sessions[name] = await loginAs(api, users[name]._id);
    }
  });

  afterAll(() => api.teardown());

  it('stores a parsed table for editors and shows it ranked to viewers of the scoreboard', async () => {
    const contest = await createContest(api, { authors: [users.editor._id] });
    await put('plain', contest.key, { csv: CSV }).expect(403);
    await put('editor', contest.key, { csv: CSV }).expect(200);
    const shown = await show(contest.key);
    expect(shown.url).toBeNull();
    expect(shown.problems).toEqual(['A', 'B']);
    expect(
      shown.rows.map((row) => [row.rank, row.username, row.totalScore]),
    ).toEqual([
      [1, 'bob', 150],
      [2, 'ann', 50],
    ]);
    expect(shown.rows[0].scores).toEqual([100, 50]);
  });

  it('replaces the table on a second upload', async () => {
    const contest = await createContest(api, { authors: [users.editor._id] });
    await put('editor', contest.key, { csv: CSV }).expect(200);
    await put('editor', contest.key, {
      csv: 'Username,Full Name,X,Points\ncy,Cy,x,7',
    }).expect(200);
    const shown = await show(contest.key);
    expect(shown.problems).toEqual([]);
    expect(shown.rows.map((row) => row.username)).toEqual(['cy']);
  });

  it('keeps a URL as given and refuses other schemes', async () => {
    const contest = await createContest(api, { authors: [users.editor._id] });
    await put('editor', contest.key, {
      url: 'https://cms.example.org/ranking',
    }).expect(200);
    const shown = await show(contest.key);
    expect(shown.url).toBe('https://cms.example.org/ranking');
    expect(shown.rows).toEqual([]);
    await put('editor', contest.key, { url: 'javascript:alert(1)' })
      .expect(400)
      .expect(errorCode('validation_failed'));
    await put('editor', contest.key, {
      csv: CSV,
      url: 'https://cms.example.org',
    }).expect(400);
    await put('editor', contest.key, {}).expect(400);
    expect((await show(contest.key)).url).toBe(
      'https://cms.example.org/ranking',
    );
  });

  it('answers a bad CSV with 400 on the csv field and an oversized body before parsing', async () => {
    const contest = await createContest(api, { authors: [users.editor._id] });
    const response = await put('editor', contest.key, {
      csv: 'Username,Full Name,X,Points\na,A,x,nan',
    }).expect(400);
    expect(
      Object.keys(
        (response.body as { error: { fields: object } }).error.fields,
      ),
    ).toEqual(['csv']);
    await put('editor', contest.key, { csv: 'x'.repeat(1_048_577) })
      .expect(400)
      .expect(errorCode('validation_failed'));
    await api
      .http()
      .get(contestUrl(contest.key, '/official-ranking'))
      .expect(404);
  });

  it('hides the table from viewers who cannot see their own scoreboard, and answers 404 once deleted', async () => {
    const hidden = await createContest(api, {
      authors: [users.editor._id],
      scoreboardVisibility: 'H',
    });
    await put('editor', hidden.key, { csv: CSV }).expect(200);
    await api
      .http()
      .get(contestUrl(hidden.key, '/official-ranking'))
      .expect(403);
    await authed(
      api.http().get(contestUrl(hidden.key, '/official-ranking')),
      sessions.editor,
    ).expect(200);
    await authed(
      api.http().delete(contestUrl(hidden.key, '/official-ranking')),
      sessions.plain,
    ).expect(403);
    await authed(
      api.http().delete(contestUrl(hidden.key, '/official-ranking')),
      sessions.editor,
    ).expect(204);
    await authed(
      api.http().get(contestUrl(hidden.key, '/official-ranking')),
      sessions.editor,
    ).expect(404);
  });
});
