import { Injectable } from '@nestjs/common';
import type { Principal } from '@libs/auth';
import {
  AppError,
  escapeRegExp,
  invalidField,
  Paginated,
  unique,
} from '@libs/common';
import { uuidStr } from '@libs/database';
import type { Problem } from '@libs/database';
import type { FilterQuery } from 'mongoose';
import { ProblemAccess } from '../../problems/core/problem-access';
import { ProblemsRepository } from '../../problems/core/problems.repository';
import type { ProblemDocument } from '../../problems/core/problems.repository';
import { OrganizationAccess } from '../core/organization-access';
import { OrganizationsService } from '../core/organizations.service';
import { ProblemTagResponse } from '../problem-tags/dto/problem-tag.response';
import { ProblemTagsRepository } from '../problem-tags/problem-tags.repository';
import type {
  OrganizationProblemListQueryDto,
  SetProblemTagsDto,
} from './dto/organization-problem.dto';
import { OrganizationProblemResponse } from './dto/organization-problem.response';
import { OrganizationProblemsRepository } from './organization-problems.repository';

const searchClause = (text: string): FilterQuery<Problem> => {
  const pattern = new RegExp(escapeRegExp(text), 'i');
  return { $or: [{ code: pattern }, { name: pattern }] };
};

@Injectable()
export class OrganizationProblemsService {
  constructor(
    private readonly organizations: OrganizationsService,
    private readonly problems: ProblemsRepository,
    private readonly links: OrganizationProblemsRepository,
    private readonly tags: ProblemTagsRepository,
  ) {}

  /** Members and administrators; the rows are the organization's problems the viewer could already see. Archived ones are hidden unless asked for. */
  async list(
    principal: Principal,
    slug: string,
    query: OrganizationProblemListQueryDto,
  ): Promise<Paginated<OrganizationProblemResponse>> {
    const organization = await this.organizations.bySlug(slug);
    const view = OrganizationAccess.accessView(organization);
    if (
      !OrganizationAccess.isMember(principal, view.id) &&
      !OrganizationAccess.canAdminister(principal, view)
    )
      throw new AppError(
        'forbidden',
        403,
        'Only members can list the organization problems',
      );
    const { page, pageSize } = query;
    const filter = await this.listFilter(principal, organization._id, query);
    const { items, total } = filter
      ? await this.problems.list(filter, { code: 1 }, page, pageSize)
      : { items: [], total: 0 };
    const rows = await this.rowsOf(organization._id, items);
    return new Paginated(rows, { page, pageSize, total });
  }

  /** `null`: the filter can match nothing (an unknown tag). */
  private async listFilter(
    principal: Principal,
    organizationId: string,
    query: OrganizationProblemListQueryDto,
  ): Promise<FilterQuery<Problem> | null> {
    const clauses: FilterQuery<Problem>[] = [
      ProblemAccess.visibleFilter(principal, null),
      { organizations: organizationId },
    ];
    if (query.search) clauses.push(searchClause(query.search));
    if (query.archived !== 'all') {
      const archived = await this.links.archivedProblemIds(organizationId);
      clauses.push({
        _id: { [query.archived === 'true' ? '$in' : '$nin']: archived },
      });
    }
    if (query.tag) {
      const tag = await this.tags.findBySlug(organizationId, query.tag);
      if (!tag) return null;
      clauses.push({
        _id: {
          $in: await this.links.problemIdsWithTag(organizationId, tag._id),
        },
      });
    }
    return { $and: clauses };
  }

  private async rowsOf(
    organizationId: string,
    problems: ProblemDocument[],
  ): Promise<OrganizationProblemResponse[]> {
    const [links, tagsById] = await Promise.all([
      this.links.findForProblems(
        organizationId,
        problems.map((problem) => problem._id),
      ),
      this.tags.mapForOrganization(organizationId),
    ]);
    return problems.map((problem) => {
      const link = links.get(uuidStr(problem._id));
      const tags = (link?.tagIds ?? []).flatMap((id) => {
        const tag = tagsById.get(uuidStr(id));
        return tag ? [ProblemTagResponse.from(tag)] : [];
      });
      return OrganizationProblemResponse.from(problem, link, tags);
    });
  }

  async setTags(
    principal: Principal,
    target: { slug: string; code: string },
    { tagIds }: SetProblemTagsDto,
  ): Promise<OrganizationProblemResponse> {
    const organization = await this.organizations.administered(
      principal,
      target.slug,
    );
    const problem = await this.ownedProblem(organization._id, target.code);
    const wanted = unique(tagIds);
    const found = await this.tags.findByIds(organization._id, wanted);
    if (found.length !== wanted.length)
      throw invalidField('tagIds', 'Unknown tag.', 'unknown_tag');
    const link = await this.links.setTags(
      organization._id,
      problem._id,
      wanted,
    );
    return OrganizationProblemResponse.from(
      problem,
      link,
      found.map((tag) => ProblemTagResponse.from(tag)),
    );
  }

  async setArchived(
    principal: Principal,
    target: { slug: string; code: string },
    archived: boolean,
  ): Promise<void> {
    const organization = await this.organizations.administered(
      principal,
      target.slug,
    );
    const problem = await this.ownedProblem(organization._id, target.code);
    await this.links.setArchived(organization._id, problem._id, archived);
  }

  /** A link exists only for organizations the problem lists; a missing, deleted or foreign problem is a 404. */
  private async ownedProblem(
    organizationId: string,
    code: string,
  ): Promise<ProblemDocument> {
    const problem = await this.problems.findByCode(code);
    if (
      !problem ||
      !problem.organizations.map(uuidStr).includes(organizationId)
    )
      throw new AppError(
        'not_found',
        404,
        'No such problem in this organization',
      );
    return problem;
  }
}
