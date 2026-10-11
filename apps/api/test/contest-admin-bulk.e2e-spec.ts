import { newId } from '@libs/database';
import type { BulkContestResponse } from '../src/modules/contests/bulk/dto/contest-bulk.response';
import type { ContestListItemResponse } from '../src/modules/contests/core/dto/contest-list.response';
import type { ContestTagResponse } from '../src/modules/contests/tags/dto/contest-tag.response';
import {
  clearRateLimits,
  contestUrl,
  createContest,
  hoursFromNow,
} from './contest-fixtures';
import { authed, createUserWith, loginAs } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';
import { dataOf, seedSubmission } from './submission-fixtures';

let api: ApiTest;

beforeAll(async () => {
  api = await setupApiTest();
});
afterAll(() => api.teardown());

const BULK = '/api/internal/contests/bulk';
const keysOf = (rows: ContestListItemResponse[]) => rows.map((row) => row.key);

describe('contest bulk edits', () => {
  let editorId: string;
  let editor: TestSession;
  let tagger: TestSession;

  beforeAll(async () => {
    await api.reset();
    editorId = (
      await createUserWith(api, 'bulk_editor', {
        permissions: [
          'judge.edit_own_contest',
          'judge.create_private_contest',
          'judge.change_contest_tag',
        ],
      })
    )._id;
    editor = await loginAs(api, editorId);
    tagger = await loginAs(
      api,
      (
        await createUserWith(api, 'bulk_tagger', {
          permissions: ['judge.change_contest_tag'],
        })
      )._id,
    );
    await api.contestTags.create({ slug: 'cup', name: 'Cup', color: 'tag-1' });
    await api.resyncCatalog();
  });
  beforeEach(() => clearRateLimits(api));

  const bulk = (path: string, body: object, session = editor) =>
    authed(api.http().post(`${BULK}/${path}`), session).send(body);
  const visibleOf = async (key: string) =>
    (await api.contests.findOne({ key }).lean())?.isVisible;

  it('shows and hides through the PATCH gates, reporting each key', async () => {
    await createContest(api, {
      key: 'bv_public',
      isVisible: false,
      authors: [editorId],
    });
    await createContest(api, {
      key: 'bv_private',
      isVisible: false,
      isPrivate: true,
      authors: [editorId],
    });
    await createContest(api, { key: 'bv_shown', authors: [editorId] });
    await createContest(api, { key: 'bv_theirs', isVisible: false });

    const shown = dataOf<BulkContestResponse>(
      await bulk('visibility', {
        keys: ['bv_public', 'bv_private', 'bv_shown', 'bv_theirs', 'bv_ghost'],
        isVisible: true,
      }).expect(200),
    );

    // Showing a public contest needs change_contest_visibility; a private one only create_private_contest.
    expect(shown).toEqual({
      results: [
        { key: 'bv_public', outcome: 'failed', reason: 'forbidden' },
        { key: 'bv_private', outcome: 'done' },
        { key: 'bv_shown', outcome: 'unchanged' },
        { key: 'bv_theirs', outcome: 'failed', reason: 'not_found' },
        { key: 'bv_ghost', outcome: 'failed', reason: 'not_found' },
      ],
      done: 1,
      failed: 3,
    });
    expect(await visibleOf('bv_public')).toBe(false);
    expect(await visibleOf('bv_private')).toBe(true);

    await bulk('visibility', {
      keys: ['bv_shown', 'bv_private'],
      isVisible: false,
    }).expect(200);
    expect(await visibleOf('bv_shown')).toBe(false);
    expect(await visibleOf('bv_private')).toBe(false);
  });

  it('adds and removes a tag only on contests the caller may edit', async () => {
    await createContest(api, { key: 'bt_mine', authors: [editorId] });
    await createContest(api, {
      key: 'bt_tagged',
      tags: ['cup'],
      authors: [editorId],
    });
    await createContest(api, { key: 'bt_theirs' });
    const tagsOf = async (key: string) =>
      (await api.contests.findOne({ key }).lean())?.tags;

    const added = dataOf<BulkContestResponse>(
      await bulk('tag', {
        keys: ['bt_mine', 'bt_tagged', 'bt_theirs'],
        tag: 'cup',
        assigned: true,
      }).expect(200),
    );

    expect(added.results.map((result) => result.outcome)).toEqual([
      'done',
      'unchanged',
      'failed',
    ]);
    expect(added.results[2]?.reason).toBe('forbidden');
    expect(await tagsOf('bt_mine')).toEqual(['cup']);
    expect(await tagsOf('bt_theirs')).toEqual([]);

    await bulk('tag', {
      keys: ['bt_mine'],
      tag: 'cup',
      assigned: false,
    }).expect(200);
    expect(await tagsOf('bt_mine')).toEqual([]);
  });

  it('refuses an unknown tag per contest, and the route without the tag permission', async () => {
    await createContest(api, { key: 'bt_unknown', authors: [editorId] });
    const result = dataOf<BulkContestResponse>(
      await bulk('tag', {
        keys: ['bt_unknown'],
        tag: 'nope',
        assigned: true,
      }).expect(200),
    );
    expect(result.results).toEqual([
      { key: 'bt_unknown', outcome: 'failed', reason: 'unknown_tag' },
    ]);
    const plain = await loginAs(
      api,
      (
        await createUserWith(api, 'bulk_plain', {
          permissions: ['judge.edit_own_contest'],
        })
      )._id,
    );
    await bulk(
      'tag',
      { keys: ['bt_unknown'], tag: 'cup', assigned: true },
      plain,
    ).expect(403);
    // Holding the tag permission does not grant edit rights on the contest.
    const viaTagger = dataOf<BulkContestResponse>(
      await bulk(
        'tag',
        { keys: ['bt_unknown'], tag: 'cup', assigned: true },
        tagger,
      ).expect(200),
    );
    expect(viaTagger.failed).toBe(1);
  });
});

describe('contest list admin filters', () => {
  let editorId: string;
  let editor: TestSession;
  let plain: TestSession;

  beforeAll(async () => {
    await api.reset();
    editorId = (
      await createUserWith(api, 'list_editor', {
        permissions: ['judge.edit_own_contest'],
      })
    )._id;
    editor = await loginAs(api, editorId);
    plain = await loginAs(api, (await createUserWith(api, 'list_plain'))._id);
    await createContest(api, {
      key: 'fl_hidden',
      name: 'Bravo',
      isVisible: false,
      authors: [editorId],
      startTime: hoursFromNow(-48),
      endTime: hoursFromNow(-46),
      userCount: 5,
    });
    await createContest(api, {
      key: 'fl_tested',
      name: 'Alpha',
      testers: [editorId],
      startTime: hoursFromNow(-24),
      endTime: hoursFromNow(-22),
      userCount: 9,
    });
    await createContest(api, {
      key: 'fl_fso',
      name: 'Charlie',
      formatName: 'final_submission',
      authors: [editorId],
      lockedAfter: hoursFromNow(-1),
      userCount: 1,
    });
    await createContest(api, { key: 'fl_other', name: 'Delta' });
  });

  const list = async (query: string, session: TestSession = editor) =>
    dataOf<ContestListItemResponse[]>(
      await authed(
        api.http().get(`/api/internal/contests?${query}`),
        session,
      ).expect(200),
    );

  it('filters hidden, own and dated contests, in the order asked', async () => {
    expect(keysOf(await list('visible=false'))).toEqual(['fl_hidden']);
    expect(keysOf(await list('visible=false', plain))).toEqual([]);
    expect(keysOf(await list('mine=true&sort=name'))).toEqual([
      'fl_tested',
      'fl_hidden',
      'fl_fso',
    ]);
    expect(keysOf(await list('sort=users'))).toEqual([
      'fl_tested',
      'fl_hidden',
      'fl_fso',
      'fl_other',
    ]);
    expect(keysOf(await list('sort=oldest'))[0]).toBe('fl_hidden');
    const from = hoursFromNow(-30).toISOString();
    const before = hoursFromNow(-12).toISOString();
    expect(
      keysOf(
        await list(
          `startFrom=${encodeURIComponent(from)}&startBefore=${encodeURIComponent(before)}`,
        ),
      ),
    ).toEqual(['fl_tested']);
  });

  it('gives the editor block only on contests the viewer may edit', async () => {
    const fso = (await api.contests.findOne({ key: 'fl_fso' }).lean())!;
    // Ids only: the pending count reads the contest and the status, nothing else.
    await seedSubmission(api, {
      contest: fso._id,
      user: editorId,
      problem: newId(),
      language: newId(),
      status: 'PD',
      result: null,
    });
    const rows = new Map(
      (await list('pageSize=10')).map((row) => [row.key, row.editor]),
    );
    expect(rows.get('fl_fso')).toEqual({
      isVisible: true,
      lockedAfter: expect.any(String) as unknown,
      pendingCount: 1,
    });
    expect(rows.get('fl_hidden')).toEqual({
      isVisible: false,
      lockedAfter: null,
      pendingCount: null,
    });
    // A tester sees the contest but may not edit it.
    expect(rows.get('fl_tested')).toBeNull();
    expect(
      (await list('pageSize=10', plain)).every((row) => row.editor === null),
    ).toBe(true);
  });

  it("counts a tag's contests among those the viewer may see", async () => {
    await api.contestTags.create({
      slug: 'cnt',
      name: 'Count',
      color: 'tag-2',
    });
    await api.resyncCatalog();
    await api.contests.updateMany(
      { key: { $in: ['fl_hidden', 'fl_other'] } },
      { $set: { tags: ['cnt'] } },
    );
    const countOf = async (session?: TestSession) => {
      const request = api.http().get('/api/internal/contest-tags');
      const rows = dataOf<ContestTagResponse[]>(
        await (session ? authed(request, session) : request).expect(200),
      );
      return rows.find((row) => row.slug === 'cnt')?.contestCount;
    };
    expect(await countOf()).toBe(1);
    expect(await countOf(editor)).toBe(2);
  });

  it('refuses a participant search to non-editors', async () => {
    await authed(
      api.http().get(contestUrl('fl_other', '/participations?search=a')),
      plain,
    ).expect(403);
  });
});
