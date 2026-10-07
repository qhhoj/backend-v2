import { Inject, Injectable } from '@nestjs/common';
import { hasPermission, UsersRepository } from '@libs/auth';
import type { Permission, Principal } from '@libs/auth';
import { AppError, ENV, unique } from '@libs/common';
import type { Env } from '@libs/common';
import {
  canWritePersonalPost,
  excerpt,
  officialContestLocks,
  pagePath,
  postSlug,
} from '@libs/community';
import { uuidStr } from '@libs/database';
import type { BlogPost } from '@libs/database';
import { fieldDiff } from '@libs/problems';
import { ContributionPointsService } from '../../contributions/contribution-points.service';
import { DiscordWebhooksService } from '../../discord/discord-webhooks.service';
import { OrganizationAccess } from '../../organizations/core/organization-access';
import { OrganizationsService } from '../../organizations/core/organizations.service';
import { RevisionsRepository } from '../../problems/core/revisions.repository';
import { renderField } from '../../problems/editing/problem-markup';
import { BlogAccess } from '../core/blog-access';
import { BlogPostsRepository } from '../core/blog-posts.repository';
import { BlogPostsService } from '../core/blog-posts.service';
import { BlogVisibilityService } from '../core/blog-visibility.service';
import type { PostDetailResponse } from '../core/dto/post.response';
import type { CreatePostDto, UpdatePostDto } from './dto/post-edit.dto';

const forbidden = (message: string) => new AppError('forbidden', 403, message);
/** Fields a revision records (the rendered HTML follows from them). */
const REVISION_FIELDS = [
  'title',
  'content',
  'summary',
  'publishOn',
  'visible',
  'globalPost',
  'sticky',
  'ogImage',
  'authors',
  'organization',
] as const;
const revisionView = (post: Partial<BlogPost>) =>
  Object.fromEntries(
    REVISION_FIELDS.filter((field) => post[field] !== undefined).map(
      (field) => [field, post[field]],
    ),
  );
/** Legacy `blog` markdown = the staff-editable sanitizing style, the same as editorials. */
const POST_STYLE = 'solution';

@Injectable()
export class BlogEditingService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly posts: BlogPostsRepository,
    private readonly visibility: BlogVisibilityService,
    private readonly reads: BlogPostsService,
    private readonly users: UsersRepository,
    private readonly organizations: OrganizationsService,
    private readonly revisions: RevisionsRepository,
    private readonly contributions: ContributionPointsService,
    private readonly discord: DiscordWebhooksService,
  ) {}

  /** Legacy `BlogPostCreate` and `BlogPostCreateOrganization`. */
  async create(
    principal: Principal,
    dto: CreatePostDto,
    now = new Date(),
  ): Promise<PostDetailResponse> {
    this.refuseInOfficialContest(principal);
    const writer = (await this.users.findById(principal.userId))!;
    const organization =
      dto.organization === undefined
        ? null
        : await this.organizations.bySlug(dto.organization);
    if (organization) {
      if (
        writer.mute ||
        !OrganizationAccess.isAdmin(
          principal,
          OrganizationAccess.accessView(organization),
        ) ||
        !hasPermission(principal, 'judge.edit_organization_post')
      )
        throw forbidden(
          'Only its admins with edit_organization_post write for this organization',
        );
    } else if (!canWritePersonalPost(writer))
      throw forbidden(
        'Solve at least 10 problems and stay unmuted to write a post',
      );
    this.assertFlags(principal, dto, { globalPost: false, sticky: false });
    const post = await this.posts.create({
      title: dto.title,
      slug: postSlug(organization ? organization.slug : principal.username),
      authors: [principal.userId],
      organization: organization ? uuidStr(organization._id) : null,
      visible: dto.visible ?? false,
      globalPost: dto.globalPost ?? false,
      sticky: dto.sticky ?? false,
      publishOn: dto.publishOn ? new Date(dto.publishOn) : now,
      ogImage: dto.ogImage ?? '',
      ...this.rendered(dto.content, dto.summary ?? ''),
    });
    await this.revisions.append({
      entity: 'blogPost',
      entityId: post._id,
      action: 'create',
      userId: principal.userId,
      changes: fieldDiff({}, revisionView(post.toJSON())),
      comment: 'Created on site',
    });
    if (
      !organization &&
      BlogAccess.isPublished(BlogAccess.accessView(post), now)
    )
      await this.announce(post, principal.username);
    return this.reads.detail(principal, post._id);
  }

  /** Legacy `BlogPostEdit` (plus the summary, image and authors legacy left to the admin site). */
  async edit(
    principal: Principal,
    id: string,
    dto: UpdatePostDto,
  ): Promise<PostDetailResponse> {
    this.refuseInOfficialContest(principal);
    const { post, view } = await this.visibility.visiblePost(principal, id);
    if (!BlogAccess.canEdit(principal, view))
      throw forbidden('You cannot edit this post');
    if ((await this.users.findById(principal.userId))!.mute)
      throw forbidden('Muted users cannot edit posts');
    this.assertFlags(principal, dto, post);
    const { authorIds, content, summary, publishOn, ...fields } = dto;
    const changes: Partial<BlogPost> = { ...fields };
    if (publishOn !== undefined) changes.publishOn = new Date(publishOn);
    if (content !== undefined || summary !== undefined)
      Object.assign(
        changes,
        this.rendered(content ?? post.content, summary ?? post.summary),
      );
    if (authorIds !== undefined) {
      this.require(
        principal,
        'judge.edit_all_post',
        'Only edit_all_post changes authors',
      );
      if (
        (await this.users.findByIds(unique(authorIds))).length !==
        unique(authorIds).length
      )
        throw new AppError('validation_failed', 400, 'Unknown authors', {
          authorIds: ['Every author must be a user.'],
        });
      changes.authors = unique(authorIds);
    }
    const before = revisionView(post.toJSON());
    await this.posts.update(id, changes);
    const after = revisionView({ ...post.toJSON(), ...changes });
    const diff = fieldDiff(before, after);
    if (Object.keys(diff).length)
      await this.revisions.append({
        entity: 'blogPost',
        entityId: post._id,
        action: 'edit',
        userId: principal.userId,
        changes: diff,
        comment: 'Edited from site',
      });
    if ('visible' in diff || 'authors' in diff)
      await this.contributions.refresh(
        unique([...view.authors, ...(changes.authors ?? [])]),
      );
    return this.reads.detail(principal, id);
  }

  /** Legacy `BlogPostDelete`: edit rights plus `delete_blogpost`. */
  async delete(principal: Principal, id: string): Promise<void> {
    const { post, view } = await this.visibility.visiblePost(principal, id);
    if (!BlogAccess.canDelete(principal, view))
      throw forbidden('You cannot delete this post');
    const commentAuthors = await this.posts.deleteWithDiscussion(id);
    await this.revisions.append({
      entity: 'blogPost',
      entityId: post._id,
      action: 'delete',
      userId: principal.userId,
      changes: fieldDiff(revisionView(post.toJSON()), {}),
      comment: 'Deleted from site',
    });
    await this.contributions.refresh(
      unique([...view.authors, ...commentAuthors]),
    );
  }

  /** `globalPost` and `sticky` need their permission to change (legacy hid the fields). */
  private assertFlags(
    principal: Principal,
    dto: Pick<UpdatePostDto, 'globalPost' | 'sticky'>,
    current: Pick<BlogPost, 'globalPost' | 'sticky'>,
  ): void {
    if (dto.globalPost !== undefined && dto.globalPost !== current.globalPost)
      this.require(
        principal,
        'judge.mark_global_post',
        'Marking a post global needs mark_global_post',
      );
    if (dto.sticky !== undefined && dto.sticky !== current.sticky)
      this.require(
        principal,
        'judge.pin_post',
        'Pinning a post needs pin_post',
      );
  }

  private require(
    principal: Principal,
    permission: Permission,
    message: string,
  ): void {
    if (!hasPermission(principal, permission)) throw forbidden(message);
  }

  private refuseInOfficialContest(principal: Principal): void {
    if (officialContestLocks(this.env.officialContestMode, principal))
      throw forbidden('Blog posts are locked during the official contest');
  }

  private rendered(content: string, summary: string) {
    return {
      content,
      contentHtml: renderField(content, POST_STYLE, 'content'),
      summary,
      summaryHtml: summary ? renderField(summary, POST_STYLE, 'summary') : '',
    };
  }

  /** Legacy `on_new_blogpost`, only once a personal post is published (legacy also sent drafts, scheduled and organization posts). */
  private announce(post: BlogPost, username: string): Promise<void> {
    return this.discord.notify('on_new_blogpost', {
      title: `New blog post ${this.discord.link(pagePath('blog', uuidStr(post._id)))}`,
      description: `Title: ${post.title}\nDescription: ${excerpt(post.content, 200)}`,
      author: this.discord.author(username),
    });
  }
}
