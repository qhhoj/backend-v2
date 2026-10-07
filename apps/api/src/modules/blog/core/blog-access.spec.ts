import type { Principal } from '@libs/auth';
import { BlogAccess } from './blog-access';
import type { BlogAccessView } from './blog-access';

const now = new Date('2026-10-07T12:00:00Z');
const past = new Date('2026-10-07T11:00:00Z');
const future = new Date('2026-10-07T13:00:00Z');
const principal = (
  userId: string,
  permissions: string[] = [],
  organizationIds: string[] = [],
): Principal => ({
  userId,
  username: userId,
  isSuperuser: false,
  isStaff: false,
  permissions: new Set(permissions),
  organizationIds,
});
const post = (extra: Partial<BlogAccessView> = {}): BlogAccessView => ({
  id: 'post',
  authors: ['author'],
  organizationId: null,
  organizationAdminIds: [],
  visible: true,
  publishOn: past,
  ...extra,
});

describe('BlogAccess', () => {
  const anonymous = null;
  const author = principal('author');
  const stranger = principal('stranger');
  const editorAll = principal('staff', ['judge.edit_all_post']);
  const member = principal('member', [], ['org']);
  const orgAdminAuthor = principal(
    'author',
    ['judge.edit_organization_post'],
    ['org'],
  );
  const orgAdminWithoutPermission = principal('author', [], ['org']);

  it('shows published personal posts to everyone and drafts to editors', () => {
    expect(BlogAccess.canSee(anonymous, post(), now)).toBe(true);
    for (const draft of [
      post({ visible: false }),
      post({ publishOn: future }),
    ]) {
      expect(BlogAccess.canSee(anonymous, draft, now)).toBe(false);
      expect(BlogAccess.canSee(stranger, draft, now)).toBe(false);
      expect(BlogAccess.canSee(author, draft, now)).toBe(true);
      expect(BlogAccess.canSee(editorAll, draft, now)).toBe(true);
    }
  });

  it('keeps organization posts to members and the post editors', () => {
    const organizationPost = post({
      organizationId: 'org',
      organizationAdminIds: ['author'],
    });
    expect(BlogAccess.canSee(anonymous, organizationPost, now)).toBe(false);
    expect(BlogAccess.canSee(stranger, organizationPost, now)).toBe(false);
    expect(BlogAccess.canSee(member, organizationPost, now)).toBe(true);
    expect(BlogAccess.canSee(editorAll, organizationPost, now)).toBe(true);
    expect(
      BlogAccess.canSee(member, { ...organizationPost, visible: false }, now),
    ).toBe(false);
  });

  it('lets organization posts be edited by author admins with edit_organization_post only', () => {
    const organizationPost = post({
      organizationId: 'org',
      organizationAdminIds: ['author'],
    });
    expect(BlogAccess.canEdit(orgAdminAuthor, organizationPost)).toBe(true);
    expect(
      BlogAccess.canEdit(orgAdminWithoutPermission, organizationPost),
    ).toBe(false);
    expect(
      BlogAccess.canEdit(orgAdminAuthor, {
        ...organizationPost,
        organizationAdminIds: [],
      }),
    ).toBe(false);
    expect(BlogAccess.canEdit(author, post())).toBe(true);
    expect(BlogAccess.canEdit(stranger, post())).toBe(false);
    expect(BlogAccess.canEdit(anonymous, post())).toBe(false);
  });

  it('needs delete_blogpost on top of edit rights to delete', () => {
    expect(BlogAccess.canDelete(author, post())).toBe(false);
    expect(
      BlogAccess.canDelete(
        principal('author', ['judge.delete_blogpost']),
        post(),
      ),
    ).toBe(true);
    expect(
      BlogAccess.canDelete(
        principal('stranger', ['judge.delete_blogpost']),
        post(),
      ),
    ).toBe(false);
  });

  it('gives organization lists to members, admins and edit_all_post only', () => {
    const organization = { id: 'org', isUnlisted: false, adminIds: ['boss'] };
    expect(
      BlogAccess.organizationFilter(stranger, organization, now),
    ).toBeNull();
    expect(
      BlogAccess.organizationFilter(anonymous, organization, now),
    ).toBeNull();
    expect(BlogAccess.organizationFilter(member, organization, now)).toEqual({
      organization: 'org',
      visible: true,
      publishOn: { $lte: now },
    });
    expect(
      BlogAccess.organizationFilter(principal('boss'), organization, now),
    ).toEqual({
      organization: 'org',
      $or: [{ visible: true }, { authors: 'boss' }],
    });
    expect(BlogAccess.organizationFilter(editorAll, organization, now)).toEqual(
      {
        organization: 'org',
      },
    );
  });
});
