import type { ContestTagResponse } from '../src/modules/contests/tags/dto/contest-tag.response';
import { createContest, contestUrl } from './contest-fixtures';
import { authed, createUserWith, loginAs } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';
import { dataOf } from './submission-fixtures';
import type { ContestListItemResponse } from '../src/modules/contests/core/dto/contest-list.response';

let api: ApiTest;

beforeAll(async () => {
  api = await setupApiTest();
});
afterAll(() => api.teardown());

// from contest-tags.e2e-spec.ts
{
  describe('contest tag catalogue', () => {
    beforeAll(() => api.reset());
    let admin: TestSession;
    let plain: TestSession;
    const url = '/api/internal/contest-tags';
    const create = (body: object, session: TestSession = admin) =>
      authed(api.http().post(url), session).send(body);
    const list = async () =>
      dataOf<ContestTagResponse[]>(await api.http().get(url).expect(200));

    beforeAll(async () => {
      admin = await loginAs(
        api,
        (
          await createUserWith(api, 'tag_admin', {
            permissions: ['judge.change_contest_tag'],
          })
        )._id,
      );
      plain = await loginAs(api, (await createUserWith(api, 'tag_plain'))._id);
    });
    beforeEach(async () => {
      await api.contestTags.deleteMany({});
      await api.resyncCatalog();
    });

    it('creates, updates and deletes only for holders of judge.change_contest_tag', async () => {
      const body = {
        slug: 'olp',
        name: 'Olympiad',
        color: 'tag-4',
        description: 'Cups',
      };
      await api.http().post(url).send(body).expect(401);
      await create(body, plain).expect(403);
      await create(body).expect(201);
      expect(await list()).toEqual([{ ...body, order: 0 }]);
      await authed(api.http().patch(`${url}/olp`), plain)
        .send({ name: 'No' })
        .expect(403);
      await authed(api.http().patch(`${url}/olp`), admin)
        .send({ name: 'Olympiad 2', color: 'tag-5' })
        .expect(200);
      expect(await list()).toEqual([
        { ...body, name: 'Olympiad 2', color: 'tag-5', order: 0 },
      ]);
      await authed(api.http().delete(`${url}/olp`), plain).expect(403);
      await authed(api.http().delete(`${url}/olp`), admin).expect(204);
      expect(await list()).toEqual([]);
    });

    it('refuses a repeated slug, a colour outside the token set and a bad slug', async () => {
      await create({ slug: 'olp', name: 'A', color: 'tag-1' }).expect(201);
      await create({ slug: 'olp', name: 'B', color: 'tag-2' })
        .expect(409)
        .expect(errorCode('conflict'));
      await create({ slug: 'new', name: 'B', color: 'red' }).expect(400);
      await create({ slug: 'Bad Slug', name: 'B', color: 'tag-1' }).expect(400);
      await create({
        slug: 'long',
        name: 'x'.repeat(41),
        color: 'tag-1',
      }).expect(400);
      expect(await list()).toHaveLength(1);
    });
  });
}

// from contest-tags-validation.e2e-spec.ts
{
  describe('contest tags in the editor', () => {
    beforeAll(() => api.reset());
    let editor: TestSession;
    let editorId: string;
    const patch = (key: string, body: object) =>
      authed(api.http().patch(contestUrl(key)), editor).send(body);
    const tagsOf = async (id: string) =>
      (await api.contests.findById(id).lean())!.tags;

    beforeAll(async () => {
      editorId = (
        await createUserWith(api, 'tags_editor', {
          permissions: ['judge.add_contest', 'judge.edit_own_contest'],
        })
      )._id;
      editor = await loginAs(api, editorId);
    });
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
      const refused = await authed(
        api.http().post('/api/internal/contests'),
        editor,
      )
        .send(body(['nope', 'olp', 'other']))
        .expect(400)
        .expect(errorCode('unknown_tag'));
      expect(
        (
          refused.body as {
            error: { issues: Array<{ field: string; code: string }> };
          }
        ).error.issues.map(({ field, code }) => `${field}:${code}`),
      ).toEqual(['tags:unknown_tag', 'tags:unknown_tag']);
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
}
