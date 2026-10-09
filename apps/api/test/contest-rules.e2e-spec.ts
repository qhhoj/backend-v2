import type { ContestDetailResponse } from '../src/modules/contests/core/dto/contest-detail.response';
import { contestUrl, createContest } from './contest-fixtures';
import { authed, createUserWith, loginAs } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';
import { dataOf } from './submission-fixtures';

describe('contest rules in the editor and the detail', () => {
  let api: ApiTest;
  let editor: TestSession;
  let editorId: string;
  const patch = (key: string, body: object) =>
    authed(api.http().patch(contestUrl(key)), editor).send(body);
  const detailOf = (response: { body: unknown }) =>
    dataOf<ContestDetailResponse>(response);

  beforeAll(async () => {
    api = await setupApiTest();
    editorId = (
      await createUserWith(api, 'rules_editor', {
        permissions: ['judge.edit_own_contest'],
      })
    )._id;
    editor = await loginAs(api, editorId);
  });
  afterAll(() => api.teardown());

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
    expect(blank).toMatchObject({ rules: '', rulesHtml: '', rulesRevision: 0 });
    const padded = detailOf(
      await patch(contest.key, { rules: '  Be fair  ' }).expect(200),
    );
    expect(padded).toMatchObject({ rules: 'Be fair', rulesRevision: 1 });
  });

  it('refuses rules past 8192 characters', async () => {
    const contest = await createContest(api, { authors: [editorId] });
    const { body } = await patch(contest.key, {
      rules: 'x'.repeat(8193),
    }).expect(400);
    const { error } = body as {
      error: { issues: { field: string; code: string }[] };
    };
    expect(error.issues).toEqual([
      expect.objectContaining({ field: 'rules', code: 'max_length' }),
    ]);
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

  it('shows the rules to a signed-out visitor of a public contest', async () => {
    const contest = await createContest(api, {
      rules: 'Public rules',
      rulesHtml: '<p>Public rules</p>',
      rulesRevision: 4,
    });
    const detail = detailOf(
      await api.http().get(contestUrl(contest.key)).expect(200),
    );
    expect(detail).toMatchObject({
      rules: 'Public rules',
      rulesHtml: '<p>Public rules</p>',
      rulesRevision: 4,
    });
  });
});
