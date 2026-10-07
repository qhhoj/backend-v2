import { hasPermission } from '@libs/auth';
import type { Permission, Principal } from '@libs/auth';
import { uuidStr } from '@libs/database';
import type { BlogPost } from '@libs/database';
import type { FilterQuery } from 'mongoose';
import { OrganizationAccess } from '../../organizations/core/organization-access';
import type { OrganizationAccessView } from '../../organizations/core/organization-access';

export interface BlogAccessView {
  id: string;
  authors: string[];
  organizationId: string | null;
  /** The organization's admins (empty for personal posts). */
  organizationAdminIds: string[];
  visible: boolean;
  publishOn: Date;
}

/** Plain-string view (UUID arrays on hydrated documents are buffers under `.map`). */
const accessView = (
  post: BlogPost,
  organizationAdminIds: readonly string[] = [],
): BlogAccessView => ({
  id: uuidStr(post._id),
  authors: post.authors.map(uuidStr),
  organizationId:
    post.organization === null ? null : uuidStr(post.organization),
  organizationAdminIds: [...organizationAdminIds],
  visible: post.visible,
  publishOn: post.publishOn,
});

const has = (principal: Principal | null, permission: Permission) =>
  principal !== null && hasPermission(principal, permission);
const isAuthor = (principal: Principal | null, post: BlogAccessView) =>
  principal !== null && post.authors.includes(principal.userId);

/** Legacy `is_editable_by`: `edit_all_post`; an organization post's author who admins it and has `edit_organization_post`; a personal post's author. */
const canEdit = (principal: Principal | null, post: BlogAccessView) =>
  has(principal, 'judge.edit_all_post') ||
  (isAuthor(principal, post) &&
    (post.organizationId === null ||
      (post.organizationAdminIds.includes(principal!.userId) &&
        has(principal, 'judge.edit_organization_post'))));

/** Legacy `BlogPostDelete`: edit rights plus `delete_blogpost`. */
const canDelete = (principal: Principal | null, post: BlogAccessView) =>
  canEdit(principal, post) && has(principal, 'judge.delete_blogpost');

const isPublished = (post: BlogAccessView, now: Date) =>
  post.visible && post.publishOn <= now;

/** Legacy `can_see`: a published personal post is public; a published organization post needs membership; anything else needs edit rights. */
const canSee = (principal: Principal | null, post: BlogAccessView, now: Date) =>
  (isPublished(post, now) &&
    (post.organizationId === null ||
      (principal !== null &&
        principal.organizationIds.includes(post.organizationId)))) ||
  canEdit(principal, post);

/** Published personal posts: the homepage lists and the blog feed (legacy fed organization posts too). */
const publishedPersonalFilter = (now: Date): FilterQuery<BlogPost> => ({
  organization: null,
  visible: true,
  publishOn: { $lte: now },
});

/** Legacy `UserBlogPage`: personal posts; the author and superusers also see drafts. */
const authorTabFilter = (
  principal: Principal | null,
  authorId: string,
  now: Date,
): FilterQuery<BlogPost> =>
  principal !== null && (principal.userId === authorId || principal.isSuperuser)
    ? { authors: authorId, organization: null }
    : { authors: authorId, ...publishedPersonalFilter(now) };

/** Legacy `OrganizationHome`: `edit_all_post` sees every post, admins visible or own ones, members published ones, anyone else none (null). */
function organizationFilter(
  principal: Principal | null,
  organization: OrganizationAccessView,
  now: Date,
): FilterQuery<BlogPost> | null {
  const base = { organization: organization.id };
  // `visible: $in` lets the `visible`-keyed sticky index serve the sort.
  if (has(principal, 'judge.edit_all_post'))
    return { ...base, visible: { $in: [true, false] } };
  if (principal && OrganizationAccess.canAdminister(principal, organization))
    return { ...base, $or: [{ visible: true }, { authors: principal.userId }] };
  if (OrganizationAccess.isMember(principal, organization.id))
    return { ...base, visible: true, publishOn: { $lte: now } };
  return null;
}

export const BlogAccess = {
  accessView,
  canEdit,
  canDelete,
  isPublished,
  canSee,
  publishedPersonalFilter,
  authorTabFilter,
  organizationFilter,
};
