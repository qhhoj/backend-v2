import { getModelToken } from '@nestjs/mongoose';
import { OrganizationProblem, OrganizationProblemTag } from '@libs/database';
import type { Model } from 'mongoose';
import { clearRateLimits } from './contest-fixtures';
import { createOrganization, organizationUrl } from './organization-fixtures';
import { seedOrganizationWorld } from './organization-problem-fixtures';
import type { OrganizationWorld } from './organization-problem-fixtures';
import { authed, createProblem, seedCatalog } from './problem-fixtures';
import type { Catalog } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { errorCode, issueCodes, setupApiTest } from './setup';
import type { ApiTest } from './setup';

interface Bulk {
  results: Array<{ code: string; outcome: string; reason?: string }>;
  done: number;
  skipped: number;
}

describe('organization problem bulk actions', () => {
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
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    tags = api.app.get(getModelToken(OrganizationProblemTag.name));
    links = api.app.get(getModelToken(OrganizationProblem.name));
  });
  beforeEach(() => clearRateLimits(api));
  afterAll(() => api.teardown());

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
    expect((await links.findOne({ problem: mine._id }).lean())?.archived).toBe(
      true,
    );
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
    await bulk(world, { codes, action: 'add-tag', tagId: tag._id }).expect(201);
    await bulk(world, { codes, action: 'add-tag', tagId: tag._id }).expect(201);
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
    await bulk(world, { codes: [problem.code], action: 'delete' }).expect(400);
    await bulk(world, { codes: [problem.code], action: 'add-tag' }).expect(400);
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
          api.http().get(`/api/internal/problems/${problem.code}/archived-in`),
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
