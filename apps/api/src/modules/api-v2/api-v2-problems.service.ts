import { Injectable } from '@nestjs/common';
import { AppError } from '@libs/common';
import { uuidStr } from '@libs/database';
import type { Problem } from '@libs/database';
import { UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import type { FilterQuery } from 'mongoose';
import { LanguagesQuerier } from '../problems/catalog/languages.querier';
import { ProblemAccess } from '../problems/core/problem-access';
import { ProblemGroupsQuerier } from '../problems/catalog/problem-groups.querier';
import { searchFilter } from '../problems/core/problem-search';
import { ProblemTypesQuerier } from '../problems/catalog/problem-types.querier';
import { ProblemsRepository } from '../problems/core/problems.repository';
import { ProblemsService } from '../problems/core/problems.service';
import { ApiV2ProblemListDto } from './dto/api-v2-problem-list.dto';
import {
  API_V2_PAGE_SIZE,
  legacyPage,
  legacyTotalPages,
} from './legacy-envelope';
import type { LegacyPage } from './legacy-envelope';

/** Legacy matches names case-insensitively, like `code`. */
const idsNamed = (
  items: Array<{ _id: string; fullName: string }>,
  names: string[],
) => {
  const lowered = names.map((name) => name.toLowerCase());
  return items
    .filter((item) => lowered.includes(item.fullName.toLowerCase()))
    .map((item) => item._id);
};

@Injectable()
export class ApiV2ProblemsService {
  constructor(
    private readonly repository: ProblemsRepository,
    private readonly problems: ProblemsService,
    private readonly users: UsersRepository,
    private readonly types: ProblemTypesQuerier,
    private readonly groups: ProblemGroupsQuerier,
    private readonly languages: LanguagesQuerier,
  ) {}

  async list(
    principal: Principal | null,
    query: ApiV2ProblemListDto,
  ): Promise<LegacyPage<Record<string, unknown>>> {
    const clauses: FilterQuery<Problem>[] = [
      // Legacy `get_visible_problems` ignores the viewer's current contest.
      ProblemAccess.visibleFilter(principal, null),
    ];
    if (query.partial !== undefined) clauses.push({ partial: query.partial });
    if (query.code) clauses.push({ code: { $in: query.code } });
    if (query.group)
      clauses.push({
        groupId: { $in: idsNamed(this.groups.all(), query.group) },
      });
    if (query.type)
      clauses.push({
        typeIds: { $in: idsNamed(this.types.all(), query.type) },
      });
    if (query.organization)
      clauses.push({ organizations: { $in: query.organization } });
    const search = query.search?.join(' ').trim();
    if (search) clauses.push(searchFilter(search));
    const filter = { $and: clauses };
    const total = await this.repository.count(filter);
    if (query.page > legacyTotalPages(total))
      throw new AppError('not_found', 404, 'page/object not found');
    const items = await this.repository.findPage(
      filter,
      { _id: 1 },
      query.page,
      API_V2_PAGE_SIZE,
    );
    return legacyPage(
      items.map((problem) => this.listItem(problem)),
      query.page,
      total,
    );
  }

  async detail(
    principal: Principal | null,
    code: string,
  ): Promise<Record<string, unknown>> {
    const problem = await this.problems.visibleProblemOutsideContest(
      principal,
      code.toLowerCase(),
    );
    const authors = await this.users.findByIds(problem.authors.map(uuidStr));
    return {
      code: problem.code,
      name: problem.name,
      authors: authors.map((user) => user.username),
      types: this.typeNames(problem),
      group: this.groupName(problem),
      time_limit: problem.timeLimit,
      memory_limit: problem.memoryLimit,
      language_resource_limits: problem.languageLimits.flatMap((limit) => {
        const language = this.languages.byId(uuidStr(limit.languageId));
        return language
          ? [
              {
                language: language.key,
                time_limit: limit.timeLimit,
                memory_limit: limit.memoryLimit,
              },
            ]
          : [];
      }),
      points: problem.points,
      partial: problem.partial,
      short_circuit: !problem.partial,
      languages: this.languages
        .byIds(problem.allowedLanguages.map(uuidStr))
        .map((language) => language.key),
      is_organization_private: problem.isOrganizationPrivate,
      organizations: problem.isOrganizationPrivate
        ? problem.organizations.map(uuidStr)
        : [],
      is_public: problem.isPublic,
    };
  }

  private listItem(problem: Problem): Record<string, unknown> {
    return {
      code: problem.code,
      name: problem.name,
      types: this.typeNames(problem),
      group: this.groupName(problem),
      points: problem.points,
      partial: problem.partial,
      is_organization_private: problem.isOrganizationPrivate,
      is_public: problem.isPublic,
    };
  }

  private groupName(problem: Problem): string | null {
    return this.groups.byId(uuidStr(problem.groupId))?.fullName ?? null;
  }

  private typeNames(problem: Problem): string[] {
    return this.types
      .byIds(problem.typeIds.map(uuidStr))
      .map((type) => type.fullName);
  }
}
