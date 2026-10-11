import { getModelToken } from '@nestjs/mongoose';
import {
  OrganizationProblem,
  OrganizationProblemTag,
  newId,
} from '@libs/database';
import type { Model } from 'mongoose';
import { createOrganization, organizationUrl } from './organization-fixtures';
import { seedOrganizationWorld } from './organization-problem-fixtures';
import type { OrganizationWorld } from './organization-problem-fixtures';
import { authed, createProblem, seedCatalog } from './problem-fixtures';
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
  });
}

// from organization-problem-bulk.e2e-spec.ts
{
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
