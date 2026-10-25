import { sha256 } from '@libs/auth';
import type { User } from '@libs/database';
import {
  ACCESS_CODE_IP_LIMIT,
  RANKING_TOKEN_MISS_LIMIT,
} from '../src/modules/contests/core/rate-limits';
import type { RankingResponse } from '../src/modules/contests/ranking/dto/ranking.response';
import type {
  PublicRankingResponse,
  RankingLinkResponse,
} from '../src/modules/contests/ranking/dto/ranking-link.response';
import {
  clearRateLimits,
  contestUrl,
  createContest,
  hoursFromNow,
  joinParticipation,
} from './contest-fixtures';
import { authed, createUserWith, loginAs } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';

describe('contest public ranking', () => {
  let api: ApiTest;
  const sessions: Record<string, TestSession> = {};
  const users: Record<string, { _id: string }> = {};
  const publicUrl = (token: string) => `/api/internal/public-rankings/${token}`;
  const createLink = async (key: string) =>
    dataOf<RankingLinkResponse>(
      await authed(
        api.http().post(contestUrl(key, '/ranking-link')),
        sessions.editor,
      ).expect(200),
    );
  const updateLink = (key: string, body: Record<string, unknown>) =>
    authed(api.http().patch(contestUrl(key, '/ranking-link')), sessions.editor)
      .send(body)
      .expect(200);

  beforeAll(async () => {
    api = await setupApiTest();
    const roles: Array<[string, Partial<User>]> = [
      [
        'editor',
        {
          permissions: ['judge.edit_own_contest', 'judge.contest_access_code'],
        },
      ],
      ['plain', {}],
      ['alice', {}],
      ['bob', {}],
    ];
    for (const [name, extra] of roles) {
      users[name] = await createUserWith(api, name, extra);
      sessions[name] = await loginAs(api, users[name]._id);
    }
  });

  afterAll(() => api.teardown());

  it('creates one link per contest for editors and regenerates its token', async () => {
    const contest = await createContest(api, { authors: [users.editor._id] });
    await authed(
      api.http().post(contestUrl(contest.key, '/ranking-link')),
      sessions.plain,
    ).expect(403);
    await authed(
      api.http().get(contestUrl(contest.key, '/ranking-link')),
      sessions.editor,
    ).expect(404);
    const first = await createLink(contest.key);
    const again = await createLink(contest.key);
    expect(again.token).toBe(first.token);
    const shown = dataOf<RankingLinkResponse>(
      await authed(
        api.http().get(contestUrl(contest.key, '/ranking-link')),
        sessions.editor,
      ).expect(200),
    );
    expect(shown.token).toBe(first.token);
    const regenerated = dataOf<RankingLinkResponse>(
      await authed(
        api.http().post(contestUrl(contest.key, '/ranking-link/regenerate')),
        sessions.editor,
      ).expect(200),
    );
    expect(regenerated.token).not.toBe(first.token);
    await api.http().get(publicUrl(first.token)).expect(404);
    await api.http().get(publicUrl(regenerated.token)).expect(200);
  });

  it('serves the live board of a private contest through a valid link, never virtual rows', async () => {
    const contest = await createContest(api, {
      isPrivate: true,
      authors: [users.editor._id],
    });
    await joinParticipation(api, contest._id, users.alice._id, { score: 200 });
    await joinParticipation(api, contest._id, users.bob._id, {
      score: 300,
      virtual: 1,
    });
    const link = await createLink(contest.key);
    const { contest: shown, ranking } = dataOf<PublicRankingResponse>(
      await api.http().get(publicUrl(link.token)).expect(200),
    );
    expect(shown.key).toBe(contest.key);
    expect(shown.formatName).toBe(contest.formatName);
    expect(shown.pointsPrecision).toBe(contest.pointsPrecision);
    expect(ranking.rows.map((row) => [row.user.username, row.score])).toEqual([
      ['alice', 200],
    ]);
  });

  it('answers unknown, private and expired tokens with the same 404 and limits misses per IP', async () => {
    await clearRateLimits(api);
    const contest = await createContest(api, { authors: [users.editor._id] });
    const link = await createLink(contest.key);
    const missBody = async (token: string) =>
      (await api.http().get(publicUrl(token)).expect(404)).body as unknown;
    const unknown = await missBody('A'.repeat(18));
    const malformed = await missBody('not-a-token!');
    await updateLink(contest.key, { status: 'private', expiryMode: 'U' });
    const privateLink = await missBody(link.token);
    await updateLink(contest.key, {
      status: 'public',
      expiryMode: 'A',
      expiresAt: hoursFromNow(-1).toISOString(),
    });
    const expired = await missBody(link.token);
    const hiddenContest = await createContest(api, {
      scoreboardVisibility: 'H',
      authors: [users.editor._id],
    });
    const hiddenLink = await createLink(hiddenContest.key);
    const hidden = await missBody(hiddenLink.token);
    expect(
      new Set(
        [unknown, malformed, privateLink, expired, hidden].map((body) =>
          JSON.stringify(body),
        ),
      ).size,
    ).toBe(1);
    for (let miss = 5; miss < RANKING_TOKEN_MISS_LIMIT; miss += 1)
      await api
        .http()
        .get(publicUrl('B'.repeat(18)))
        .expect(404);
    await api
      .http()
      .get(publicUrl('B'.repeat(18)))
      .expect(429)
      .expect(errorCode('rate_limited'));
  });

  it('gives the miss back on a hit', async () => {
    await clearRateLimits(api);
    const contest = await createContest(api, { authors: [users.editor._id] });
    const link = await createLink(contest.key);
    for (let hit = 0; hit < RANKING_TOKEN_MISS_LIMIT + 5; hit += 1)
      await api.http().get(publicUrl(link.token)).expect(200);
  });

  it('applies expiry settings: days count from regeneration, a link stays valid until then', async () => {
    const contest = await createContest(api, { authors: [users.editor._id] });
    const link = await createLink(contest.key);
    const updated = dataOf<RankingLinkResponse>(
      await updateLink(contest.key, {
        status: 'public',
        expiryMode: 'D',
        expiryAmount: 2,
      }),
    );
    const expected = new Date(updated.regeneratedAt).getTime() + 2 * 86_400_000;
    expect(new Date(updated.expiresAt!).getTime()).toBe(expected);
    expect(updated.isValid).toBe(true);
    await api.http().get(publicUrl(link.token)).expect(200);
    await authed(
      api.http().patch(contestUrl(contest.key, '/ranking-link')),
      sessions.editor,
    )
      .send({ status: 'public', expiryMode: 'D' })
      .expect(400);
  });

  it('shows the full board with the ranking code, frozen for non-editors, and limits wrong codes per IP', async () => {
    await clearRateLimits(api);
    const contest = await createContest(api, {
      scoreboardVisibility: 'H',
      formatName: 'icpc',
      formatConfig: {},
      frozenLastMinutes: 180,
      authors: [users.editor._id],
    });
    await authed(api.http().patch(contestUrl(contest.key)), sessions.editor)
      .send({ rankingAccessCode: 'board-code' })
      .expect(200);
    expect(
      (await api.contests.findById(contest._id).lean())!.rankingAccessCodeHash,
    ).toBe(sha256('board-code'));
    await joinParticipation(api, contest._id, users.alice._id, {
      score: 3,
      frozenScore: 1,
    });
    await api.http().get(contestUrl(contest.key, '/ranking')).expect(403);
    const board = dataOf<RankingResponse>(
      await api
        .http()
        .get(contestUrl(contest.key, '/ranking?code=board-code'))
        .expect(200),
    );
    expect([board.frozen, board.rows[0].score]).toEqual([true, 1]);
    const editorBoard = dataOf<RankingResponse>(
      await authed(
        api.http().get(contestUrl(contest.key, '/ranking?code=board-code')),
        sessions.editor,
      ).expect(200),
    );
    expect([editorBoard.frozen, editorBoard.rows[0].score]).toEqual([false, 3]);
    for (let attempt = 0; attempt < ACCESS_CODE_IP_LIMIT; attempt += 1)
      await api
        .http()
        .get(contestUrl(contest.key, '/ranking?code=wrong'))
        .expect(403);
    await api
      .http()
      .get(contestUrl(contest.key, '/ranking?code=wrong'))
      .expect(429);
    await authed(api.http().patch(contestUrl(contest.key)), sessions.editor)
      .send({ rankingAccessCode: '' })
      .expect(200);
    expect(
      (await api.contests.findById(contest._id).lean())!.rankingAccessCodeHash,
    ).toBeNull();
    // Without a code there is nothing to guess: refused before the (spent) budget.
    await api
      .http()
      .get(contestUrl(contest.key, '/ranking?code=wrong'))
      .expect(403);
  });

  it('never serves editors a cached board', async () => {
    await clearRateLimits(api);
    const contest = await createContest(api, {
      scoreboardCacheTimeout: 60,
      authors: [users.editor._id],
    });
    await authed(api.http().patch(contestUrl(contest.key)), sessions.editor)
      .send({ rankingAccessCode: 'cache-code' })
      .expect(200);
    const participation = await joinParticipation(
      api,
      contest._id,
      users.alice._id,
      { score: 1, frozenScore: 1 },
    );
    const scoreSeen = async (path: string, who?: string) => {
      const request = api.http().get(contestUrl(contest.key, path));
      const board = dataOf<RankingResponse>(
        await (who ? authed(request, sessions[who]) : request).expect(200),
      );
      return board.rows[0].score;
    };
    expect(await scoreSeen('/ranking?code=cache-code')).toBe(1);
    await api.participations.updateOne(
      { _id: participation._id },
      { score: 5, frozenScore: 5 },
    );
    expect(await scoreSeen('/ranking?code=cache-code')).toBe(1);
    expect(await scoreSeen('/ranking?code=cache-code', 'editor')).toBe(5);
    expect(await scoreSeen('/ranking', 'editor')).toBe(5);
  });
});
