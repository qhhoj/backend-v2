import { Injectable } from '@nestjs/common';
import { hasPermission } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError, Paginated, RateLimitService } from '@libs/common';
import type { RenderPreviewResponse } from '@libs/common';
import {
  RENDER_PREVIEW_LIMIT,
  RENDER_PREVIEW_WINDOW_SECONDS,
} from '../../problems/core/rate-limits';
import { renderField } from '../../problems/editing/problem-markup';
import { OrganizationPointsService } from '../core/organization-points.service';
import { OrganizationsRepository } from '../core/organizations.repository';
import { OrganizationsService } from '../core/organizations.service';
import type { OrganizationRevisionResponse } from './dto/organization-revision.response';
import { OrganizationRevisionsService } from './organization-revisions.service';

/** The editor's helpers around a save: the about preview, the change history and the staff points repair. */
@Injectable()
export class OrganizationToolsService {
  constructor(
    private readonly organizationsService: OrganizationsService,
    private readonly organizations: OrganizationsRepository,
    private readonly points: OrganizationPointsService,
    private readonly revisions: OrganizationRevisionsService,
    private readonly rateLimit: RateLimitService,
  ) {}

  /** Legacy `recalculate_points` action: queues the worker's recompute of PP and member count. */
  async recalculate(slug: string): Promise<void> {
    const organization = await this.organizationsService.bySlug(slug);
    await this.points.refresh([organization._id]);
  }

  /** Administrators only, like the edit itself. */
  async history(
    principal: Principal,
    slug: string,
    page: number,
  ): Promise<Paginated<OrganizationRevisionResponse>> {
    const organization = await this.organizationsService.administered(
      principal,
      slug,
    );
    return this.revisions.history(organization._id, page);
  }

  /** Renders `about` exactly as a save would, for whoever may write one: a creator, staff, or an admin of some organization. */
  async preview(
    principal: Principal,
    markdown: string,
  ): Promise<RenderPreviewResponse> {
    if (!(await this.mayWriteAbout(principal)))
      throw new AppError(
        'forbidden',
        403,
        'Only organization creators and administrators may preview',
      );
    await this.rateLimit.reserve(
      [`render-preview:user:${principal.userId}`],
      RENDER_PREVIEW_LIMIT,
      RENDER_PREVIEW_WINDOW_SECONDS,
    );
    return { html: renderField(markdown, 'user', 'about') };
  }

  private async mayWriteAbout(principal: Principal): Promise<boolean> {
    return (
      hasPermission(principal, 'judge.add_organization') ||
      hasPermission(principal, 'judge.edit_all_organization') ||
      (await this.organizations.countAdminRoles(principal.userId)) > 0
    );
  }
}
