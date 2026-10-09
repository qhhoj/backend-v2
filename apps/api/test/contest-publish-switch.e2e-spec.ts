import type { ContestDetailResponse } from '../src/modules/contests/core/dto/contest-detail.response';
import { contestUrl, createContest } from './contest-fixtures';
import { authed, createUserWith, loginAs } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';
import { dataOf } from './submission-fixtures';

describe('auto-publish switch in the contest editor', () => {
  let api: ApiTest;
  const sessions: Record<string, TestSession> = {};
  const ids: Record<string, string> = {};
  const patch = (who: string, key: string, body: object) =>
    authed(api.http().patch(contestUrl(key)), sessions[who]).send(body);
  const settingsOf = (response: { body: unknown }) =>
    dataOf<ContestDetailResponse>(response).settings!;

  beforeAll(async () => {
    api = await setupApiTest();
    for (const name of ['first_editor', 'second_editor']) {
      ids[name] = (
        await createUserWith(api, name, {
          permissions: ['judge.edit_own_contest', 'judge.add_contest'],
        })
      )._id;
      sessions[name] = await loginAs(api, ids[name]);
    }
  });
  afterAll(() => api.teardown());

  it('records who switched it on, keeps them when it is sent again, and forgets them when it goes off', async () => {
    const contest = await createContest(api, {
      authors: [ids.first_editor, ids.second_editor],
    });
    const on = settingsOf(
      await patch('first_editor', contest.key, {
        publishAfterEnd: true,
      }).expect(200),
    );
    expect(on).toMatchObject({
      publishAfterEnd: true,
      publishAfterEndBy: ids.first_editor,
    });
    const again = settingsOf(
      await patch('second_editor', contest.key, {
        publishAfterEnd: true,
      }).expect(200),
    );
    expect(again.publishAfterEndBy).toBe(ids.first_editor);
    const off = settingsOf(
      await patch('second_editor', contest.key, {
        publishAfterEnd: false,
      }).expect(200),
    );
    expect(off).toMatchObject({
      publishAfterEnd: false,
      publishAfterEndBy: null,
    });
    const back = settingsOf(
      await patch('second_editor', contest.key, {
        publishAfterEnd: true,
      }).expect(200),
    );
    expect(back.publishAfterEndBy).toBe(ids.second_editor);
  });

  it('clears an earlier outcome when it is switched on again', async () => {
    const contest = await createContest(api, {
      authors: [ids.first_editor],
      publishAfterEnd: false,
      autoPublishOutcome: {
        at: new Date(),
        status: 'failed',
        reason: 'no_permission',
        published: 0,
        skipped: 2,
      },
    });
    await patch('first_editor', contest.key, { publishAfterEnd: true }).expect(
      200,
    );
    expect(
      (await api.contests.findById(contest._id).lean())!.autoPublishOutcome,
    ).toBeNull();
  });

  it('sets the editor when a contest is created with the switch on', async () => {
    const created = dataOf<ContestDetailResponse>(
      await authed(
        api.http().post('/api/internal/contests'),
        sessions.first_editor,
      )
        .send({
          key: 'switch_create',
          name: 'Switch',
          startTime: new Date(Date.now() + 3_600_000).toISOString(),
          endTime: new Date(Date.now() + 7_200_000).toISOString(),
          publishAfterEnd: true,
        })
        .expect(201),
    );
    expect(created.settings).toMatchObject({
      publishAfterEnd: true,
      publishAfterEndBy: ids.first_editor,
    });
  });
});
