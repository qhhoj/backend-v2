import { getModelToken } from '@nestjs/mongoose';
import {
  OrganizationProblem,
  OrganizationProblemTag,
  MAX_ORGANIZATION_TAGS,
  newId,
} from '@libs/database';
import type { Model } from 'mongoose';
import { createOrganization, organizationUrl } from './organization-fixtures';
import { seedOrganizationWorld } from './organization-problem-fixtures';
import type { OrganizationWorld } from './organization-problem-fixtures';
import {
  authed,
  createProblem,
  seedCatalog,
  createUserWith,
  loginAs,
} from './problem-fixtures';
import type { Catalog, TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { errorCode, issueCodes, setupApiTest } from './setup';
import type { ApiTest } from './setup';
import { clearRateLimits } from './contest-fixtures';

let api: ApiTest;

beforeAll(async () => {
  api = await setupApiTest();
});
afterAll(() => api.teardown());

// from organization-problems.e2e-spec.ts
{
  interface Row {
    code: string;
    name: string;
    isArchived: boolean;
    updatedAt: string;
    tags: Array<{ slug: string }>;
  }

  describe('organization problems', () => {
    beforeAll(() => api.reset());
    let catalog: Catalog;
    let tags: Model<OrganizationProblemTag>;
    let links: Model<OrganizationProblem>;
    let counter = 0;
    const orgProblem = (
      organizationIds: string[],
      extra: Record<string, unknown> = {},
    ) => {
      counter += 1;
      return createProblem(api, catalog, {
        code: `op${counter}`,
        isPublic: true,
        isOrganizationPrivate: true,
        organizations: organizationIds,
        ...extra,
      });
    };
    const listUrl = (slug: string, query = '') =>
      organizationUrl(slug, `/problems${query}`);
    const codesOf = async (world: OrganizationWorld, query = '') =>
      dataOf<Row[]>(
        await authed(
          api.http().get(listUrl(world.organization.slug, query)),
          world.member.session,
        ).expect(200),
      ).map((row) => row.code);
    const makeTag = (world: OrganizationWorld, slug: string) =>
      tags.create({ organization: world.organization._id, slug, name: slug });

    beforeAll(async () => {
      catalog = await seedCatalog(api);
      tags = api.app.get(getModelToken(OrganizationProblemTag.name));
      links = api.app.get(getModelToken(OrganizationProblem.name));
    });

    it('lists only the organization problems a member can see, to members only', async () => {
      const world = await seedOrganizationWorld(api);
      const other = await createOrganization(api);
      const mine = await orgProblem([world.organization._id]);
      // visible to everyone: only the organization scope keeps it out of this list
      await orgProblem([other._id], { isOrganizationPrivate: false });
      await orgProblem([world.organization._id], { isPublic: false });
      await orgProblem([world.organization._id], { deletedAt: new Date() });
      expect(await codesOf(world)).toEqual([mine.code]);
      await authed(
        api.http().get(listUrl(world.organization.slug)),
        world.outsider.session,
      )
        .expect(403)
        .expect(errorCode('forbidden'));
      await api.http().get(listUrl(world.organization.slug)).expect(401);
    });

    it('hides archived problems by default and filters by archived, tag and search', async () => {
      const world = await seedOrganizationWorld(api);
      const live = await orgProblem([world.organization._id], {
        name: 'Shortest paths',
      });
      const old = await orgProblem([world.organization._id], {
        name: 'Old sums',
      });
      const graphs = await makeTag(world, 'graphs');
      await links.create({
        organization: world.organization._id,
        problem: live._id,
        tagIds: [graphs._id],
      });
      await links.create({
        organization: world.organization._id,
        problem: old._id,
        archived: true,
      });
      expect(await codesOf(world)).toEqual([live.code]);
      expect(await codesOf(world, '?archived=true')).toEqual([old.code]);
      expect(await codesOf(world, '?archived=all')).toEqual(
        [live.code, old.code].sort(),
      );
      expect(await codesOf(world, '?tag=graphs')).toEqual([live.code]);
      expect(await codesOf(world, '?tag=nothere')).toEqual([]);
      expect(await codesOf(world, '?archived=all&q=sums')).toEqual([old.code]);
      await authed(
        api.http().get(listUrl(world.organization.slug, '?archived=maybe')),
        world.member.session,
      ).expect(400);
    });

    it('shows each problem with its tags and archived flag', async () => {
      const world = await seedOrganizationWorld(api);
      const problem = await orgProblem([world.organization._id]);
      const tag = await makeTag(world, 'dp');
      await links.create({
        organization: world.organization._id,
        problem: problem._id,
        tagIds: [tag._id],
      });
      const rows = dataOf<Row[]>(
        await authed(
          api.http().get(listUrl(world.organization.slug)),
          world.member.session,
        ),
      );
      expect(rows[0]).toMatchObject({
        code: problem.code,
        isArchived: false,
        tags: [{ slug: 'dp' }],
      });
    });

    it('shows when each problem was last updated, and a later edit moves it', async () => {
      const world = await seedOrganizationWorld(api);
      const problem = await orgProblem([world.organization._id]);
      const rowOf = async () =>
        dataOf<Row[]>(
          await authed(
            api.http().get(listUrl(world.organization.slug)),
            world.member.session,
          ).expect(200),
        )[0];
      const stored = await api.problems.findOne({ _id: problem._id }).lean();
      expect(new Date((await rowOf()).updatedAt)).toEqual(stored?.updatedAt);
      await api.problems.updateOne(
        { _id: problem._id },
        { $set: { name: 'Renamed later' } },
      );
      const edited = await api.problems.findOne({ _id: problem._id }).lean();
      expect(edited!.updatedAt.getTime()).toBeGreaterThan(
        stored!.updatedAt.getTime(),
      );
      expect(new Date((await rowOf()).updatedAt)).toEqual(edited?.updatedAt);
      // tagging writes the link, not the problem: the column must not move
      await links.create({
        organization: world.organization._id,
        problem: problem._id,
        tagIds: [],
      });
      expect(new Date((await rowOf()).updatedAt)).toEqual(edited?.updatedAt);
    });

    it('archiving in one organization leaves the other organization and the public list alone', async () => {
      const left = await seedOrganizationWorld(api);
      const right = await seedOrganizationWorld(api);
      const shared = await orgProblem([
        left.organization._id,
        right.organization._id,
      ]);
      await authed(
        api
          .http()
          .post(listUrl(left.organization.slug, `/${shared.code}/archive`)),
        left.admin.session,
      ).expect(204);
      expect(await codesOf(left)).toEqual([]);
      expect(await codesOf(right)).toEqual([shared.code]);
      const publicList = await authed(
        api.http().get('/api/internal/problems'),
        right.member.session,
      ).expect(200);
      expect(JSON.stringify(dataOf(publicList))).toContain(shared.code);
      await authed(
        api
          .http()
          .delete(listUrl(left.organization.slug, `/${shared.code}/archive`)),
        left.admin.session,
      ).expect(204);
      expect(await codesOf(left)).toEqual([shared.code]);
    });

    it('keeps archive writes to administrators and to problems of the organization', async () => {
      const world = await seedOrganizationWorld(api);
      const outside = await orgProblem([(await createOrganization(api))._id]);
      const mine = await orgProblem([world.organization._id]);
      const archive = (code: string, session = world.admin.session) =>
        authed(
          api.http().post(listUrl(world.organization.slug, `/${code}/archive`)),
          session,
        );
      await archive(mine.code, world.member.session).expect(403);
      await archive(outside.code).expect(404);
      await archive('missing').expect(404);
      await archive(mine.code).expect(204);
      await archive(mine.code).expect(204);
      expect(
        await links.countDocuments({
          organization: world.organization._id,
          problem: mine._id,
        }),
      ).toBe(1);
    });

    it('sets the tags of a problem and refuses tags of another organization', async () => {
      const world = await seedOrganizationWorld(api);
      const stranger = await seedOrganizationWorld(api);
      const problem = await orgProblem([world.organization._id]);
      const own = await makeTag(world, 'own');
      const foreign = await makeTag(stranger, 'foreign');
      const put = (tagIds: string[], session = world.admin.session) =>
        authed(
          api
            .http()
            .put(listUrl(world.organization.slug, `/${problem.code}/tags`)),
          session,
        ).send({ tagIds });
      const done = await put([own._id]).expect(200);
      expect(dataOf<Row>(done).tags.map((tag) => tag.slug)).toEqual(['own']);
      await put([foreign._id])
        .expect(400)
        .expect(errorCode('validation_failed'))
        .expect(issueCodes(['unknown_tag']));
      await put([own._id], world.member.session).expect(403);
      expect(dataOf<Row>(await put([]).expect(200)).tags).toEqual([]);
    });

    it('refuses to tag a problem that left the organization', async () => {
      const world = await seedOrganizationWorld(api);
      const problem = await orgProblem([world.organization._id]);
      const tag = await makeTag(world, 'gone');
      await api.problems.updateOne(
        { _id: problem._id },
        { $set: { organizations: [] } },
      );
      await authed(
        api
          .http()
          .put(listUrl(world.organization.slug, `/${problem.code}/tags`)),
        world.admin.session,
      )
        .send({ tagIds: [tag._id] })
        .expect(404);
    });
  });
}

// from organization-problem-bulk.e2e-spec.ts
{
  interface Bulk {
    results: Array<{ code: string; outcome: string; reason?: string }>;
    done: number;
    skipped: number;
  }

  describe('organization problem bulk actions', () => {
    beforeAll(() => api.reset());
    let catalog: Catalog;
    let tags: Model<OrganizationProblemTag>;
    let links: Model<OrganizationProblem>;
    let counter = 0;
    const orgProblem = (
      organizationIds: string[],
      extra: Record<string, unknown> = {},
    ) => {
      counter += 1;
      return createProblem(api, catalog, {
        code: `bk${counter}`,
        isPublic: true,
        isOrganizationPrivate: true,
        organizations: organizationIds,
        ...extra,
      });
    };
    const bulk = (
      world: OrganizationWorld,
      body: object,
      session = world.admin.session,
    ) =>
      authed(
        api
          .http()
          .post(organizationUrl(world.organization.slug, '/problems/bulk')),
        session,
      ).send(body);

    beforeAll(async () => {
      catalog = await seedCatalog(api);
      tags = api.app.get(getModelToken(OrganizationProblemTag.name));
      links = api.app.get(getModelToken(OrganizationProblem.name));
    });
    beforeEach(() => clearRateLimits(api));

    it('archives what it can and reports the rest per code', async () => {
      const world = await seedOrganizationWorld(api);
      const mine = await orgProblem([world.organization._id]);
      const foreign = await orgProblem([(await createOrganization(api))._id]);
      const deleted = await orgProblem([world.organization._id], {
        deletedAt: new Date(),
      });
      const result = dataOf<Bulk>(
        await bulk(world, {
          codes: [mine.code, foreign.code, deleted.code, 'nope'],
          action: 'archive',
        }).expect(201),
      );
      expect(result.results).toEqual([
        { code: mine.code, outcome: 'done' },
        { code: foreign.code, outcome: 'skipped', reason: 'not_found' },
        { code: deleted.code, outcome: 'skipped', reason: 'not_found' },
        { code: 'nope', outcome: 'skipped', reason: 'not_found' },
      ]);
      expect([result.done, result.skipped]).toEqual([1, 3]);
      expect(await links.countDocuments({ problem: foreign._id })).toBe(0);
      expect(
        (await links.findOne({ problem: mine._id }).lean())?.archived,
      ).toBe(true);
    });

    it('adds and removes a tag across problems without duplicating it', async () => {
      const world = await seedOrganizationWorld(api);
      const first = await orgProblem([world.organization._id]);
      const second = await orgProblem([world.organization._id]);
      const tag = await tags.create({
        organization: world.organization._id,
        slug: 'bulk',
        name: 'Bulk',
      });
      const codes = [first.code, second.code];
      await bulk(world, { codes, action: 'add-tag', tagId: tag._id }).expect(
        201,
      );
      await bulk(world, { codes, action: 'add-tag', tagId: tag._id }).expect(
        201,
      );
      const rows = await links
        .find({ organization: world.organization._id })
        .lean();
      expect(rows.map((row) => row.tagIds.map(String))).toEqual([
        [tag._id],
        [tag._id],
      ]);
      await bulk(world, { codes, action: 'remove-tag', tagId: tag._id }).expect(
        201,
      );
      const after = await links
        .find({ organization: world.organization._id })
        .lean();
      expect(after.every((row) => row.tagIds.length === 0)).toBe(true);
    });

    it('unarchives', async () => {
      const world = await seedOrganizationWorld(api);
      const problem = await orgProblem([world.organization._id]);
      await links.create({
        organization: world.organization._id,
        problem: problem._id,
        archived: true,
      });
      await bulk(world, { codes: [problem.code], action: 'unarchive' }).expect(
        201,
      );
      expect(
        (await links.findOne({ problem: problem._id }).lean())?.archived,
      ).toBe(false);
    });

    it('validates the request and the tag', async () => {
      const world = await seedOrganizationWorld(api);
      const stranger = await seedOrganizationWorld(api);
      const foreignTag = await tags.create({
        organization: stranger.organization._id,
        slug: 'x',
        name: 'X',
      });
      const problem = await orgProblem([world.organization._id]);
      const many = Array.from({ length: 101 }, (_unused, index) => `c${index}`);
      await bulk(world, { codes: [], action: 'archive' }).expect(400);
      await bulk(world, { codes: many, action: 'archive' }).expect(400);
      await bulk(world, { codes: [problem.code], action: 'delete' }).expect(
        400,
      );
      await bulk(world, { codes: [problem.code], action: 'add-tag' }).expect(
        400,
      );
      await bulk(world, {
        codes: [problem.code],
        action: 'archive',
        tagId: 'not-a-uuid',
      })
        .expect(400)
        .expect(issueCodes(['unexpected_tag']));
      await bulk(world, {
        codes: [problem.code],
        action: 'add-tag',
        tagId: foreignTag._id,
      })
        .expect(400)
        .expect(issueCodes(['unknown_tag']));
      await bulk(world, {
        codes: [problem.code, problem.code],
        action: 'archive',
      }).expect(400);
    });

    it('is for administrators and limited to 20 requests an hour', async () => {
      const world = await seedOrganizationWorld(api);
      const problem = await orgProblem([world.organization._id]);
      const body = { codes: [problem.code], action: 'archive' };
      await bulk(world, body, world.member.session).expect(403);
      for (let index = 0; index < 20; index += 1)
        await bulk(world, body).expect(201);
      await bulk(world, body).expect(429).expect(errorCode('rate_limited'));
    });

    it('tells a member which of their organizations archived a problem', async () => {
      const world = await seedOrganizationWorld(api);
      const other = await seedOrganizationWorld(api);
      const problem = await orgProblem([
        world.organization._id,
        other.organization._id,
      ]);
      for (const { organization } of [world, other])
        await links.create({
          organization: organization._id,
          problem: problem._id,
          archived: true,
        });
      const archivedIn = async (session: typeof world.member.session) =>
        dataOf<{ organizations: Array<{ slug: string }> }>(
          await authed(
            api
              .http()
              .get(`/api/internal/problems/${problem.code}/archived-in`),
            session,
          ).expect(200),
        ).organizations.map((organization) => organization.slug);
      expect(await archivedIn(world.member.session)).toEqual([
        world.organization.slug,
      ]);
      expect(await archivedIn(other.admin.session)).toEqual([
        other.organization.slug,
      ]);
      await authed(
        api.http().get('/api/internal/problems/missing/archived-in'),
        world.member.session,
      ).expect(404);
      const hidden = await orgProblem([other.organization._id], {
        isPublic: false,
      });
      await authed(
        api.http().get(`/api/internal/problems/${hidden.code}/archived-in`),
        world.member.session,
      ).expect(404);
      await api
        .http()
        .get(`/api/internal/problems/${problem.code}/archived-in`)
        .expect(401);
    });
  });
}

// from organization-problem-tags.e2e-spec.ts
{
  interface Tag {
    id: string;
    slug: string;
    name: string;
    color: string;
  }

  describe('organization problem tags', () => {
    beforeAll(() => api.reset());
    let tags: Model<OrganizationProblemTag>;
    let links: Model<OrganizationProblem>;
    const url = (slug: string, suffix = '') =>
      organizationUrl(slug, `/problem-tags${suffix}`);
    const post = (path: string, session: TestSession, body: object) =>
      authed(api.http().post(path), session).send(body);

    beforeAll(() => {
      tags = api.app.get(getModelToken(OrganizationProblemTag.name));
      links = api.app.get(getModelToken(OrganizationProblem.name));
    });

    it('lets an admin create tags, members read them and outsiders neither', async () => {
      const world = await seedOrganizationWorld(api);
      const { slug } = world.organization;
      const created = dataOf<Tag>(
        await post(url(slug), world.admin.session, {
          slug: 'graphs',
          name: 'Graphs',
          color: 'tag-3',
        }).expect(201),
      );
      expect(created).toMatchObject({
        slug: 'graphs',
        name: 'Graphs',
        color: 'tag-3',
      });
      const listed = await authed(
        api.http().get(url(slug)),
        world.member.session,
      ).expect(200);
      expect(dataOf<Tag[]>(listed).map((tag) => tag.slug)).toEqual(['graphs']);
      await authed(api.http().get(url(slug)), world.outsider.session)
        .expect(403)
        .expect(errorCode('forbidden'));
      await post(url(slug), world.member.session, {
        slug: 'dp',
        name: 'DP',
      }).expect(403);
    });

    it('lets staff with edit_all_organization manage any organization', async () => {
      const world = await seedOrganizationWorld(api);
      const staff = await createUserWith(api, 'tagstaff', {
        permissions: ['judge.edit_all_organization'],
      });
      await post(url(world.organization.slug), await loginAs(api, staff._id), {
        slug: 'staffmade',
        name: 'Staff',
      }).expect(201);
    });

    it('refuses a duplicate slug in one organization and allows it in another', async () => {
      const first = await seedOrganizationWorld(api);
      const second = await seedOrganizationWorld(api);
      const create = (world: typeof first, name: string) =>
        post(url(world.organization.slug), world.admin.session, {
          slug: 'dup',
          name,
        });
      await create(first, 'A').expect(201);
      await create(first, 'B')
        .expect(409)
        .expect(errorCode('conflict'))
        .expect(issueCodes(['slug_taken']));
      await create(second, 'A').expect(201);
    });

    it('refuses the hundred-and-first tag', async () => {
      const world = await seedOrganizationWorld(api);
      await tags.insertMany(
        Array.from({ length: MAX_ORGANIZATION_TAGS }, (_unused, index) => ({
          organization: world.organization._id,
          slug: `t${index}`,
          name: `Tag ${index}`,
        })),
      );
      await post(url(world.organization.slug), world.admin.session, {
        slug: 'one-more',
        name: 'Over',
      })
        .expect(409)
        .expect(errorCode('conflict'))
        .expect(issueCodes(['tag_limit_reached']))
        .expect(
          ({ body }: { body: { error: { issues: { field: string }[] } } }) =>
            expect(body.error.issues[0].field).toBe(''),
        );
    });

    it('validates slug and colour', async () => {
      const world = await seedOrganizationWorld(api);
      const { slug } = world.organization;
      const create = (body: object) =>
        post(url(slug), world.admin.session, body);
      await create({ slug: 'Bad Slug', name: 'X' }).expect(400);
      await create({ slug: 'ok', name: 'X', color: '#fff' }).expect(400);
      await create({ slug: 'ok', name: '' }).expect(400);
    });

    it('renames and recolours a tag but never changes its slug', async () => {
      const world = await seedOrganizationWorld(api);
      const { slug } = world.organization;
      await post(url(slug), world.admin.session, {
        slug: 'old',
        name: 'Old',
        color: 'tag-1',
      });
      const patch = (path: string, session: TestSession, body: object) =>
        authed(api.http().patch(url(slug, path)), session).send(body);
      await patch('/old', world.admin.session, { slug: 'renamed' }).expect(400);
      await patch('/old', world.admin.session, {
        name: 'New',
        color: 'tag-5',
      }).expect(200);
      expect(await tags.countDocuments({ slug: 'renamed' })).toBe(0);
      expect(
        await tags.findOne({
          organization: world.organization._id,
          slug: 'old',
        }),
      ).toMatchObject({ name: 'New', color: 'tag-5' });
      await patch('/old', world.admin.session, { name: null })
        .expect(400)
        .expect(issueCodes(['must_not_be_null']));
      await patch('/old', world.admin.session, { color: null }).expect(400);
      expect(await tags.countDocuments({ slug: 'old', name: null })).toBe(0);
      await patch('/missing', world.admin.session, { name: 'x' }).expect(404);
      await patch('/old', world.member.session, { name: 'x' }).expect(403);
    });

    it('deleting a tag removes it from every link of that organization only', async () => {
      const world = await seedOrganizationWorld(api);
      const other = await seedOrganizationWorld(api);
      const { slug } = world.organization;
      const make = async (tagSlug: string) =>
        dataOf<Tag>(
          await post(url(slug), world.admin.session, {
            slug: tagSlug,
            name: tagSlug,
          }),
        );
      const doomed = await make('doomed');
      const kept = await make('kept');
      const problem = newId();
      await links.create({
        organization: world.organization._id,
        problem,
        tagIds: [doomed.id, kept.id],
      });
      const foreignTag = newId();
      await links.create({
        organization: other.organization._id,
        problem,
        tagIds: [doomed.id, foreignTag],
      });
      await authed(
        api.http().delete(url(slug, '/doomed')),
        world.admin.session,
      ).expect(204);
      const mine = await links
        .findOne({ organization: world.organization._id, problem })
        .lean();
      expect((mine?.tagIds ?? []).map(String)).toEqual([kept.id]);
      const theirs = await links
        .findOne({ organization: other.organization._id, problem })
        .lean();
      expect((theirs?.tagIds ?? []).map(String)).toEqual([
        doomed.id,
        foreignTag,
      ]);
      expect(
        await tags.countDocuments({
          organization: world.organization._id,
          slug: 'doomed',
        }),
      ).toBe(0);
      await authed(
        api.http().delete(url(slug, '/doomed')),
        world.admin.session,
      ).expect(404);
    });
  });
}
