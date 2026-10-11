import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { Permission, Principal } from '@libs/auth';
import { BlogPost, DatabaseModule, newId } from '@libs/database';
import { startMongo } from '@libs/database/testing';
import type { TestMongo } from '@libs/database/testing';
import type { FilterQuery, Model } from 'mongoose';
import { BlogAccess } from './blog-access';
import type { BlogAccessView } from './blog-access';

const ME = newId();
const OTHER = newId();
/** I admin MINE; OTHER admins THEIRS. */
const MINE = newId();
const THEIRS = newId();
const ADMINS: Record<string, string[]> = { [MINE]: [ME], [THEIRS]: [OTHER] };
const NOW = new Date('2026-10-11T12:00:00Z');
const PAST = new Date('2026-10-10T12:00:00Z');
const FUTURE = new Date('2026-10-12T12:00:00Z');

const principal = (
  permissions: Permission[] = [],
  organizationIds: string[] = [],
): Principal => ({
  userId: ME,
  username: 'me',
  isSuperuser: false,
  isStaff: false,
  permissions: new Set(permissions),
  organizationIds,
});

describe('BlogAccess list filters against stored posts', () => {
  let mongo: TestMongo;
  let testingModule: TestingModule;
  let posts: Model<BlogPost>;
  const views: BlogAccessView[] = [];

  beforeAll(async () => {
    mongo = await startMongo();
    process.env.MONGO_URL = mongo.getUri('qhhoj');
    testingModule = await Test.createTestingModule({
      imports: [DatabaseModule],
    }).compile();
    posts = testingModule.get(getModelToken(BlogPost.name));
    for (const author of [ME, OTHER])
      for (const organizationId of [null, MINE, THEIRS])
        for (const visible of [true, false])
          for (const publishOn of [PAST, FUTURE])
            views.push({
              id: newId(),
              authors: [author],
              organizationId,
              organizationAdminIds: organizationId
                ? ADMINS[organizationId]
                : [],
              visible,
              publishOn,
            });
    await posts.insertMany(
      views.map((view) => ({
        _id: view.id,
        title: 't',
        slug: 's',
        content: 'c',
        authors: view.authors,
        organization: view.organizationId,
        visible: view.visible,
        publishOn: view.publishOn,
      })),
    );
  });
  afterAll(async () => {
    await testingModule.close();
    await mongo.stop();
  });

  const idsMatching = async (filter: FilterQuery<BlogPost>) =>
    (await posts.find(filter, { _id: 1 }).lean())
      .map((row) => String(row._id))
      .sort();
  const idsOf = (keep: (view: BlogAccessView) => boolean) =>
    views
      .filter(keep)
      .map((view) => view.id)
      .sort();
  const isUnpublished = (view: BlogAccessView) =>
    !BlogAccess.isPublished(view, NOW);

  it.each<[string, Permission[]]>([
    ['a plain author', []],
    ['an organization poster', ['judge.edit_organization_post']],
    ['an edit_all_post holder', ['judge.edit_all_post']],
  ])(
    'lists as my drafts exactly my unpublished posts %s may edit',
    async (_who, permissions) => {
      const viewer = principal(permissions);
      const expected = idsOf(
        (view) =>
          view.authors.includes(ME) &&
          isUnpublished(view) &&
          BlogAccess.canEdit(viewer, view),
      );
      const actual = await idsMatching(
        BlogAccess.ownDraftsFilter(viewer, [MINE], NOW),
      );
      expect(actual).toEqual(expected);
      expect(actual.length).toBeGreaterThan(0);
    },
  );

  it('never lists my drafts to anyone else', async () => {
    const other: Principal = {
      ...principal(['judge.edit_all_post']),
      userId: OTHER,
    };
    const listed = await idsMatching(
      BlogAccess.ownDraftsFilter(other, [THEIRS], NOW),
    );
    expect(
      views.filter(
        (view) => listed.includes(view.id) && view.authors.includes(ME),
      ),
    ).toEqual([]);
  });

  it.each<[string, Principal, boolean]>([
    ['a member', { ...principal([], [MINE]), userId: newId() }, false],
    ['an admin', principal(['judge.edit_organization_post']), true],
    ['an admin without edit_organization_post', principal(), false],
  ])(
    "hides other people's drafts and scheduled posts from %s on the organization page",
    async (_who, viewer, seesOwnUnpublished) => {
      const organization = { id: MINE, isUnlisted: false, adminIds: [ME] };
      const listed = await idsMatching(
        BlogAccess.organizationFilter(viewer, organization, NOW)!,
      );
      const expected = idsOf(
        (view) =>
          view.organizationId === MINE &&
          (!isUnpublished(view) ||
            (seesOwnUnpublished && view.authors.includes(viewer.userId))),
      );
      expect(listed).toEqual(expected);
    },
  );
});
