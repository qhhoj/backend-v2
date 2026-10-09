import { getModelToken } from '@nestjs/mongoose';
import {
  MAX_ORGANIZATION_TAGS,
  OrganizationProblem,
  OrganizationProblemTag,
  newId,
} from '@libs/database';
import type { Model } from 'mongoose';
import { organizationUrl } from './organization-fixtures';
import { seedOrganizationWorld } from './organization-problem-fixtures';
import { authed, createUserWith, loginAs } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { errorCode, issueCodes, setupApiTest } from './setup';
import type { ApiTest } from './setup';

interface Tag {
  id: string;
  slug: string;
  name: string;
  color: string;
}

describe('organization problem tags', () => {
  let api: ApiTest;
  let tags: Model<OrganizationProblemTag>;
  let links: Model<OrganizationProblem>;
  const url = (slug: string, suffix = '') =>
    organizationUrl(slug, `/problem-tags${suffix}`);
  const post = (path: string, session: TestSession, body: object) =>
    authed(api.http().post(path), session).send(body);

  beforeAll(async () => {
    api = await setupApiTest();
    tags = api.app.get(getModelToken(OrganizationProblemTag.name));
    links = api.app.get(getModelToken(OrganizationProblem.name));
  });
  afterAll(() => api.teardown());

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
      .expect(issueCodes(['tag_limit_reached']));
  });

  it('validates slug and colour', async () => {
    const world = await seedOrganizationWorld(api);
    const { slug } = world.organization;
    const create = (body: object) => post(url(slug), world.admin.session, body);
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
    expect((theirs?.tagIds ?? []).map(String)).toEqual([doomed.id, foreignTag]);
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
