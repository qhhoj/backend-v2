import { Injectable } from '@nestjs/common';
import { ProblemAccess } from './problem-access';
import { Paginated } from '@libs/common';
import type { Principal } from '@libs/auth';
import type { Problem } from '@libs/database';
import type { FilterQuery } from 'mongoose';
import { ProblemListQueryDto } from './dto/problem-list.dto';
import { ProblemListItemResponse } from './dto/problem-list.response';
import {
  listSort,
  publicEditorialFilter,
  searchFilter,
} from './problem-search';
import { ProblemsRepository } from './problems.repository';
import {
  CatalogItemResponse,
  LanguageResponse,
  LicenseResponse,
  ProblemMetaResponse,
} from './dto/problem-meta.response';
import { LanguagesQuerier } from './languages.querier';
import { LicensesQuerier } from './licenses.querier';
import { ProblemGroupsQuerier } from './problem-groups.querier';
import { ProblemTypesQuerier } from './problem-types.querier';

const byField =
  <Item>(field: keyof Item) =>
  (left: Item, right: Item) =>
    String(left[field]).localeCompare(String(right[field]));

@Injectable()
export class ProblemsService {
  constructor(
    private readonly types: ProblemTypesQuerier,
    private readonly groups: ProblemGroupsQuerier,
    private readonly licenses: LicensesQuerier,
    private readonly languages: LanguagesQuerier,
    private readonly repository: ProblemsRepository,
  ) {}

  meta(): ProblemMetaResponse {
    return {
      types: this.types
        .all()
        .sort(byField('fullName'))
        .map(CatalogItemResponse.from),
      groups: this.groups
        .all()
        .sort(byField('fullName'))
        .map(CatalogItemResponse.from),
      licenses: this.licenses
        .all()
        .sort(byField('name'))
        .map(LicenseResponse.from),
      languages: this.languages
        .all()
        .sort(byField('name'))
        .map(LanguageResponse.from),
    };
  }

  async list(
    principal: Principal | null,
    query: ProblemListQueryDto,
  ): Promise<Paginated<ProblemListItemResponse>> {
    const { items, total } = await this.repository.list(
      this.listFilter(principal, query),
      listSort(query.sort),
      query.page,
      query.pageSize,
    );
    return new Paginated(
      items.map((problem) =>
        ProblemListItemResponse.from(
          problem,
          query.lang,
          this.types,
          this.groups,
        ),
      ),
      { page: query.page, pageSize: query.pageSize, total },
    );
  }

  private listFilter(
    principal: Principal | null,
    query: ProblemListQueryDto,
  ): FilterQuery<Problem> {
    const clauses: FilterQuery<Problem>[] = [
      ProblemAccess.visibleFilter(principal),
    ];
    if (query.visibility !== 'all')
      clauses.push({ isPublic: query.visibility === 'public' });
    if (query.groupId) clauses.push({ groupId: query.groupId });
    if (query.typeIds?.length)
      clauses.push({ typeIds: { $in: query.typeIds } });
    if (query.pointsMin !== undefined)
      clauses.push({ points: { $gte: query.pointsMin } });
    if (query.pointsMax !== undefined)
      clauses.push({ points: { $lte: query.pointsMax } });
    if (query.hasEditorial !== undefined)
      clauses.push(
        query.hasEditorial
          ? publicEditorialFilter()
          : { $nor: [publicEditorialFilter()] },
      );
    const search = query.search?.trim();
    if (search) clauses.push(searchFilter(search));
    return { $and: clauses };
  }
}
