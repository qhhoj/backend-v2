import { Injectable } from '@nestjs/common';
import { hasPermission, UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import type { Paginated } from '@libs/common';
import { BLOG_MIN_PROBLEM_COUNT, canWritePersonalPost } from '@libs/community';
import { OrganizationSummaryResponse } from '../../organizations/core/dto/organization.response';
import { OrganizationAccess } from '../../organizations/core/organization-access';
import { OrganizationsRepository } from '../../organizations/core/organizations.repository';
import { BlogAccess } from '../core/blog-access';
import { BlogPostsService } from '../core/blog-posts.service';
import type { PostListItemResponse } from '../core/dto/post.response';
import type { PostComposeOptionsResponse } from './dto/post-compose.response';

/** The organizations offered, by name (the organization list's page cap). */
const MAX_ORGANIZATIONS = 100;

/** What the signed-in writer has in progress and where they may post. */
@Injectable()
export class BlogDraftsService {
  constructor(
    private readonly users: UsersRepository,
    private readonly organizations: OrganizationsRepository,
    private readonly reads: BlogPostsService,
  ) {}

  /** The viewer's own drafts and scheduled posts they may still edit, newest publish time first. */
  async drafts(
    principal: Principal,
    page: number,
    now = new Date(),
  ): Promise<Paginated<PostListItemResponse>> {
    const needsAdminIds =
      hasPermission(principal, 'judge.edit_organization_post') &&
      !hasPermission(principal, 'judge.edit_all_post');
    const administered = needsAdminIds
      ? await this.organizations.idsAdministeredBy(principal.userId)
      : [];
    return this.reads.pageOf(
      principal,
      BlogAccess.ownDraftsFilter(principal, administered, now),
      { publishOn: -1, _id: -1 },
      page,
    );
  }

  /** The `BlogEditingService.create` rules asked ahead (organizations: `canAdminister`), so the editor offers only what will be accepted. */
  async composeOptions(
    principal: Principal,
  ): Promise<PostComposeOptionsResponse> {
    const writer = await this.users.signedIn(principal);
    const filter = OrganizationAccess.administeredFilter(principal);
    const mayPostForOrganizations =
      filter !== null &&
      !writer.mute &&
      hasPermission(principal, 'judge.edit_organization_post');
    const organizations = mayPostForOrganizations
      ? (await this.organizations.list(filter, 1, MAX_ORGANIZATIONS)).items
      : [];
    return {
      canWritePersonal: canWritePersonalPost(writer),
      minSolvedProblems: BLOG_MIN_PROBLEM_COUNT,
      organizations: organizations.map((organization) =>
        OrganizationSummaryResponse.from(organization),
      ),
    };
  }
}
