import { getModelToken } from '@nestjs/mongoose';
import { OrganizationProblem, OrganizationProblemTag } from '@libs/database';
import type { Model } from 'mongoose';
import { createOrganization, organizationUrl } from './organization-fixtures';
import { seedOrganizationWorld } from './organization-problem-fixtures';
import type { OrganizationWorld } from './organization-problem-fixtures';
import { authed, createProblem, seedCatalog } from './problem-fixtures';
import type { Catalog } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { errorCode, issueCodes, setupApiTest } from './setup';
import type { ApiTest } from './setup';

interface Row {
  code: string;
  name: string;
  isArchived: boolean;
  updatedAt: string;
  tags: Array<{ slug: string }>;
}

describe('organization problems', () => {
  let api: ApiTest;
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
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    tags = api.app.get(getModelToken(OrganizationProblemTag.name));
    links = api.app.get(getModelToken(OrganizationProblem.name));
  });
  afterAll(() => api.teardown());

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
      api.http().put(listUrl(world.organization.slug, `/${problem.code}/tags`)),
      world.admin.session,
    )
      .send({ tagIds: [tag._id] })
      .expect(404);
  });
});
