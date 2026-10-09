import type { ContestListItemResponse } from '../src/modules/contests/core/dto/contest-list.response';
import { contestUrl, createContest } from './contest-fixtures';
import { authed, createUserWith, loginAs } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';
import { dataOf } from './submission-fixtures';

describe('contest tags in the editor', () => {
  let api: ApiTest;
  let editor: TestSession;
  let editorId: string;
  const patch = (key: string, body: object) =>
    authed(api.http().patch(contestUrl(key)), editor).send(body);
  const tagsOf = async (id: string) =>
    (await api.contests.findById(id).lean())!.tags;

  beforeAll(async () => {
    api = await setupApiTest();
    editorId = (
      await createUserWith(api, 'tags_editor', {
        permissions: ['judge.add_contest', 'judge.edit_own_contest'],
      })
    )._id;
    editor = await loginAs(api, editorId);
  });
  afterAll(() => api.teardown());
  beforeEach(async () => {
    await api.contests.deleteMany({});
    await api.contestTags.deleteMany({});
    await api.contestTags.create({
      slug: 'olp',
      name: 'Olympiad',
      color: 'tag-1',
    });
    await api.resyncCatalog();
  });

  it('refuses an unknown tag on create and accepts a catalogue tag', async () => {
    const body = (tags: string[]) => ({
      key: `tagged_${tags[0]}`,
      name: 'Tagged',
      startTime: new Date(Date.now() + 3_600_000).toISOString(),
      endTime: new Date(Date.now() + 7_200_000).toISOString(),
      tags,
    });
    await authed(api.http().post('/api/internal/contests'), editor)
      .send(body(['nope']))
      .expect(400)
      .expect(errorCode('unknown_tag'));
    await authed(api.http().post('/api/internal/contests'), editor)
      .send(body(['olp']))
      .expect(201);
  });

  it('saves an old contest with a legacy slug when only the title changes', async () => {
    const contest = await createContest(api, {
      authors: [editorId],
      tags: ['olp2019'],
    });
    await patch(contest.key, { name: 'Renamed', tags: ['olp2019'] }).expect(
      200,
    );
    expect(await tagsOf(contest._id)).toEqual(['olp2019']);
  });

  it('lets a legacy slug be replaced or removed and refuses a new unknown slug next to it', async () => {
    const contest = await createContest(api, {
      authors: [editorId],
      tags: ['olp2019'],
    });
    await patch(contest.key, { tags: ['olp2019', 'newone'] })
      .expect(400)
      .expect(errorCode('unknown_tag'));
    expect(await tagsOf(contest._id)).toEqual(['olp2019']);
    await patch(contest.key, { tags: ['olp'] }).expect(200);
    expect(await tagsOf(contest._id)).toEqual(['olp']);
    await patch(contest.key, { tags: [] }).expect(200);
    expect(await tagsOf(contest._id)).toEqual([]);
  });

  it('filters the list by a catalogue tag and by a legacy slug', async () => {
    const catalogued = await createContest(api, { tags: ['olp'] });
    const legacy = await createContest(api, { tags: ['olp2019'] });
    await createContest(api);
    const keysOf = async (tag: string) =>
      dataOf<ContestListItemResponse[]>(
        await api.http().get(`/api/internal/contests?tag=${tag}`).expect(200),
      ).map((contest) => contest.key);
    expect(await keysOf('olp')).toEqual([catalogued.key]);
    expect(await keysOf('olp2019')).toEqual([legacy.key]);
  });
});
