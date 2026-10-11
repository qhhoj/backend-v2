import type { ContestDetailResponse } from '../src/modules/contests/core/dto/contest-detail.response';

import {
  contestUrl,
  createContest,
  clearRateLimits,
  hoursFromNow,
} from './contest-fixtures';

import { authed, createUserWith, loginAs } from './problem-fixtures';

import type { TestSession } from './problem-fixtures';

import { setupApiTest, errorCode } from './setup';

import type { ApiTest } from './setup';

import { dataOf } from './submission-fixtures';

let api: ApiTest;

beforeAll(async () => {
  api = await setupApiTest();
});
afterAll(() => api.teardown());

// from contest-rules.e2e-spec.ts
{
  describe('contest rules in the editor and the detail', () => {
    beforeAll(() => api.reset());
    let editor: TestSession;
    let editorId: string;
    const patch = (key: string, body: object) =>
      authed(api.http().patch(contestUrl(key)), editor).send(body);
    const detailOf = (response: { body: unknown }) =>
      dataOf<ContestDetailResponse>(response);

    beforeAll(async () => {
      editorId = (
        await createUserWith(api, 'rules_editor', {
          permissions: ['judge.edit_own_contest'],
        })
      )._id;
      editor = await loginAs(api, editorId);
    });

    it('stores rules, renders them sanitised and bumps the revision only when the text changes', async () => {
      const contest = await createContest(api, { authors: [editorId] });
      const first = detailOf(
        await patch(contest.key, {
          rules: '**Be fair** <script>alert(1)</script>',
        }).expect(200),
      );
      expect(first.rules).toBe('**Be fair** <script>alert(1)</script>');
      expect(first.rulesHtml).toContain('<strong>Be fair</strong>');
      expect(first.rulesHtml).not.toContain('<script');
      expect(first.rulesRevision).toBe(1);

      const renamed = detailOf(
        await patch(contest.key, {
          name: 'Renamed',
          rules: '**Be fair** <script>alert(1)</script>',
        }).expect(200),
      );
      expect(renamed.rulesRevision).toBe(1);

      const edited = detailOf(
        await patch(contest.key, { rules: 'New rules' }).expect(200),
      );
      expect(edited.rulesRevision).toBe(2);
      const cleared = detailOf(
        await patch(contest.key, { rules: '' }).expect(200),
      );
      expect(cleared).toMatchObject({
        rules: '',
        rulesHtml: '',
        rulesRevision: 3,
      });
    });

    it('treats whitespace-only rules as no rules and trims the stored text', async () => {
      const contest = await createContest(api, { authors: [editorId] });
      const blank = detailOf(
        await patch(contest.key, { rules: '  \n ' }).expect(200),
      );
      expect(blank).toMatchObject({
        rules: '',
        rulesHtml: '',
        rulesRevision: 0,
      });
      const padded = detailOf(
        await patch(contest.key, { rules: '  Be fair  ' }).expect(200),
      );
      expect(padded).toMatchObject({ rules: 'Be fair', rulesRevision: 1 });
    });

    it('keeps the revision equal to the number of text changes under concurrent saves', async () => {
      const contest = await createContest(api, { authors: [editorId] });
      const statuses = (
        await Promise.all(
          ['first text', 'second text', 'third text'].map((rules) =>
            patch(contest.key, { rules }),
          ),
        )
      ).map((response) => response.status);
      const saved = statuses.filter((status) => status === 200).length;
      expect(statuses.every((status) => status === 200 || status === 409)).toBe(
        true,
      );
      const stored = await api.contests.findById(contest._id).lean();
      expect(stored!.rulesRevision).toBe(saved);
    });
  });
}

// from contest-rules-acceptance.e2e-spec.ts
{
  describe('contest rules acceptance', () => {
    beforeAll(() => api.reset());
    const sessions: Record<string, TestSession> = {};
    const ids: Record<string, string> = {};
    const rules = {
      rules: 'No sharing.',
      rulesHtml: '<p>No sharing.</p>',
      rulesRevision: 1,
    };
    const post = (
      who: string,
      key: string,
      action: string,
      body: object = {},
    ) =>
      authed(
        api.http().post(contestUrl(key, `/${action}`)),
        sessions[who],
      ).send(body);
    const rowsOf = (contestId: string, who: string) =>
      api.participations
        .find({ contest: contestId, user: ids[who] })
        .sort({ virtual: 1 })
        .lean();
    const newUser = async (name: string, extra: object = {}) => {
      ids[name] = (await createUserWith(api, name, extra))._id;
      sessions[name] = await loginAs(api, ids[name]);
    };

    beforeAll(async () => {
      for (const name of ['alice', 'bob', 'carol', 'dave', 'tester'])
        await newUser(name);
      await newUser('editor', { permissions: ['judge.edit_own_contest'] });
    });
    beforeEach(() => clearRateLimits(api));

    it('refuses a registration without acceptance and stores time and revision with it', async () => {
      const contest = await createContest(api, {
        ...rules,
        registrationStart: hoursFromNow(-2),
        registrationEnd: hoursFromNow(1),
      });
      const refused = await post('alice', contest.key, 'register').expect(400);
      expect(refused.body).toMatchObject({
        error: {
          code: 'rules_not_accepted',
          issues: [{ field: 'acceptRules', code: 'rules_not_accepted' }],
        },
      });
      await post('alice', contest.key, 'register', { acceptRules: false })
        .expect(400)
        .expect(errorCode('rules_not_accepted'));
      expect(await rowsOf(contest._id, 'alice')).toHaveLength(0);
      await post('alice', contest.key, 'register', {
        acceptRules: true,
      }).expect(201);
      const [row] = await rowsOf(contest._id, 'alice');
      expect(row.rulesAcceptedRevision).toBe(1);
      expect(row.rulesAcceptedAt).toBeInstanceOf(Date);
    });

    it('asks for acceptance on the first live join and not for a contest without rules', async () => {
      const withRules = await createContest(api, rules);
      const without = await createContest(api);
      await post('bob', withRules.key, 'join')
        .expect(400)
        .expect(errorCode('rules_not_accepted'));
      await post('bob', withRules.key, 'join', { acceptRules: true }).expect(
        201,
      );
      await post('bob', without.key, 'join').expect(201);
      expect((await rowsOf(without._id, 'bob'))[0].rulesAcceptedAt).toBeNull();
    });

    it('exempts spectating and re-entering, even after the rules were edited', async () => {
      const contest = await createContest(api, {
        ...rules,
        testers: [ids.tester],
        registrationStart: hoursFromNow(-2),
        registrationEnd: hoursFromNow(1),
      });
      const spectated = dataOf<{ virtual: number }>(
        await post('tester', contest.key, 'join').expect(201),
      );
      expect(spectated.virtual).toBe(-1);
      await post('dave', contest.key, 'register', { acceptRules: true }).expect(
        201,
      );
      await api.contests.updateOne(
        { _id: contest._id },
        { rules: 'New', rulesRevision: 2 },
      );
      await post('dave', contest.key, 'join').expect(201);
      const [row] = await rowsOf(contest._id, 'dave');
      expect(row.rulesAcceptedRevision).toBe(1);
    });

    it('asks again for every new virtual join and stores each revision', async () => {
      const contest = await createContest(api, {
        ...rules,
        startTime: hoursFromNow(-5),
        endTime: hoursFromNow(-1),
      });
      await post('alice', contest.key, 'join')
        .expect(400)
        .expect(errorCode('rules_not_accepted'));
      await post('alice', contest.key, 'join', { acceptRules: true }).expect(
        201,
      );
      await api.contests.updateOne({ _id: contest._id }, { rulesRevision: 2 });
      await post('alice', contest.key, 'join')
        .expect(400)
        .expect(errorCode('rules_not_accepted'));
      await post('alice', contest.key, 'join', { acceptRules: true }).expect(
        201,
      );
      const rows = await rowsOf(contest._id, 'alice');
      expect(
        rows.map((row) => [row.virtual, row.rulesAcceptedRevision]),
      ).toEqual([
        [1, 1],
        [2, 2],
      ]);
    });
  });
}
