import { Injectable } from '@nestjs/common';
import type { Principal } from '@libs/auth';
import { AppError, unique } from '@libs/common';
import { uuidStr } from '@libs/database';
import type { BlogPost, Organization } from '@libs/database';
import { OrganizationsRepository } from '../../organizations/core/organizations.repository';
import { BlogAccess } from './blog-access';
import type { BlogAccessView } from './blog-access';
import { BlogPostsRepository } from './blog-posts.repository';
import type { BlogPostDocument } from './blog-posts.repository';

/** Builds `BlogAccess` views (organization admins read in one query) and finds visible posts. */
@Injectable()
export class BlogVisibilityService {
  constructor(
    private readonly posts: BlogPostsRepository,
    private readonly organizations: OrganizationsRepository,
  ) {}

  async viewsOf(
    posts: readonly BlogPost[],
  ): Promise<Map<string, BlogAccessView>> {
    return (await this.describe(posts)).views;
  }

  /** One organization read serves both the admin lists of the views and the organizations themselves. */
  private async describe(posts: readonly BlogPost[]) {
    const organizationIds = unique(
      posts.flatMap((post) =>
        post.organization === null ? [] : [uuidStr(post.organization)],
      ),
    );
    const organizations = new Map(
      (await this.organizations.findByIds(organizationIds)).map(
        (organization) => [uuidStr(organization._id), organization],
      ),
    );
    const views = new Map(
      posts.map((post) => [
        uuidStr(post._id),
        BlogAccess.accessView(
          post,
          post.organization === null
            ? []
            : (organizations
                .get(uuidStr(post.organization))
                ?.adminIds.map(uuidStr) ?? []),
        ),
      ]),
    );
    return { views, organizations };
  }

  /** 404 for malformed, unknown and invisible ids alike, so existence never leaks. */
  async visiblePost(
    principal: Principal | null,
    id: string,
    now = new Date(),
  ): Promise<{
    post: BlogPostDocument;
    view: BlogAccessView;
    organization: Organization | null;
  }> {
    const post = await this.posts.findById(id);
    const { views, organizations } = await this.describe(post ? [post] : []);
    const view = post && views.get(uuidStr(post._id));
    if (!post || !view || !BlogAccess.canSee(principal, view, now))
      throw new AppError('not_found', 404, 'No such post');
    return {
      post,
      view,
      organization: view.organizationId
        ? (organizations.get(view.organizationId) ?? null)
        : null,
    };
  }
}
