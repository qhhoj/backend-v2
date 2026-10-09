import { Injectable } from '@nestjs/common';
import type { Principal } from '@libs/auth';
import {
  AppError,
  conflictIssue,
  isDuplicateKey,
  Paginated,
} from '@libs/common';
import { MAX_ORGANIZATION_TAGS } from '@libs/database';
import { OrganizationAccess } from '../core/organization-access';
import { OrganizationsService } from '../core/organizations.service';
import type { OrganizationDocument } from '../core/organizations.repository';
import type {
  CreateProblemTagDto,
  ProblemTagListQueryDto,
  UpdateProblemTagDto,
} from './dto/problem-tag.dto';
import { ProblemTagResponse } from './dto/problem-tag.response';
import { ProblemTagsRepository } from './problem-tags.repository';

const notFound = () => new AppError('not_found', 404, 'No such problem tag');

@Injectable()
export class ProblemTagsService {
  constructor(
    private readonly organizations: OrganizationsService,
    private readonly tags: ProblemTagsRepository,
  ) {}

  /** Members and administrators read; everyone else is refused (the tags describe the organization's own problems). */
  async list(
    principal: Principal,
    slug: string,
    { page, pageSize }: ProblemTagListQueryDto,
  ): Promise<Paginated<ProblemTagResponse>> {
    const organization = await this.readable(principal, slug);
    const { items, total } = await this.tags.list(
      organization._id,
      page,
      pageSize,
    );
    return new Paginated(
      items.map((tag) => ProblemTagResponse.from(tag)),
      { page, pageSize, total },
    );
  }

  /** The cap is check-then-insert: parallel creates at 99 tags can pass it together and leave a few more than the limit (accepted, see decisions.md). */
  async create(
    principal: Principal,
    slug: string,
    dto: CreateProblemTagDto,
  ): Promise<ProblemTagResponse> {
    const organization = await this.organizations.administered(principal, slug);
    if ((await this.tags.count(organization._id)) >= MAX_ORGANIZATION_TAGS)
      throw conflictIssue(
        '',
        'tag_limit_reached',
        `An organization may have at most ${MAX_ORGANIZATION_TAGS} problem tags`,
      );
    try {
      return ProblemTagResponse.from(
        await this.tags.create({ ...dto, organization: organization._id }),
      );
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      throw conflictIssue('slug', 'slug_taken', 'This tag slug is taken');
    }
  }

  async update(
    principal: Principal,
    target: { slug: string; tagSlug: string },
    dto: UpdateProblemTagDto,
  ): Promise<ProblemTagResponse> {
    const organization = await this.organizations.administered(
      principal,
      target.slug,
    );
    const tag = await this.tags.findBySlug(organization._id, target.tagSlug);
    if (!tag) throw notFound();
    await this.tags.update(tag._id, dto);
    const updated = await this.tags.findBySlug(
      organization._id,
      target.tagSlug,
    );
    return ProblemTagResponse.from(updated ?? tag);
  }

  async remove(
    principal: Principal,
    target: { slug: string; tagSlug: string },
  ): Promise<void> {
    const organization = await this.organizations.administered(
      principal,
      target.slug,
    );
    const tag = await this.tags.findBySlug(organization._id, target.tagSlug);
    if (!tag) throw notFound();
    await this.tags.remove(organization._id, tag._id);
  }

  private async readable(
    principal: Principal,
    slug: string,
  ): Promise<OrganizationDocument> {
    const organization = await this.organizations.bySlug(slug);
    const view = OrganizationAccess.accessView(organization);
    if (
      !OrganizationAccess.isMember(principal, view.id) &&
      !OrganizationAccess.canAdminister(principal, view)
    )
      throw new AppError(
        'forbidden',
        403,
        'Only members of the organization can read its problem tags',
      );
    return organization;
  }
}
