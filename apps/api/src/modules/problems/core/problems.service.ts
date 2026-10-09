import { Injectable } from '@nestjs/common';
import { hasPermission, UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError, Paginated } from '@libs/common';
import { PROBLEM_CODE_PATTERN, uuidStr } from '@libs/database';
import type { Problem, StatementLanguage } from '@libs/database';
import type { FilterQuery } from 'mongoose';
import { CurrentContestService } from '../../contests/core/current-contest.service';
import type { CurrentParticipation } from '../../contests/core/current-contest.service';
import { ParticipationsRepository } from '../../contests/core/participations.repository';
import { EditorialResponse } from './dto/editorial.response';
import {
  ProblemContestResponse,
  ProblemDetailResponse,
} from './dto/problem-detail.response';
import { UserSummaryResponse } from './dto/user-summary.response';
import { ProblemListQueryDto } from './dto/problem-list.dto';
import { ProblemListItemResponse } from './dto/problem-list.response';
import { ProblemAccess } from './problem-access';
import type { ContestScope } from './problem-access';
import {
  isEditorialPublished,
  listSort,
  publicEditorialFilter,
  searchFilter,
} from './problem-search';
import { ProblemsRepository } from './problems.repository';
import type { ProblemDocument } from './problems.repository';
import {
  CatalogItemResponse,
  LanguageResponse,
  LicenseResponse,
  ProblemMetaResponse,
} from './dto/problem-meta.response';
import { LanguagesQuerier } from '../catalog/languages.querier';
import { LicensesQuerier } from '../catalog/licenses.querier';
import { ProblemGroupsQuerier } from '../catalog/problem-groups.querier';
import { ProblemTypesQuerier } from '../catalog/problem-types.querier';
import { ViewerStatusRepository } from './viewer-status.repository';
import type { ViewerMark } from './viewer-status.repository';

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
    private readonly users: UsersRepository,
    private readonly viewerStatuses: ViewerStatusRepository,
    private readonly currentContest: CurrentContestService,
    private readonly participations: ParticipationsRepository,
  ) {}

  meta(): ProblemMetaResponse {
    return {
      types: this.types
        .all()
        .sort(byField('fullName'))
        .map((item) => CatalogItemResponse.from(item)),
      groups: this.groups
        .all()
        .sort(byField('fullName'))
        .map((item) => CatalogItemResponse.from(item)),
      licenses: this.licenses
        .all()
        .sort(byField('name'))
        .map((license) => LicenseResponse.from(license)),
      languages: this.languages
        .all()
        .sort(byField('name'))
        .map((language) => LanguageResponse.from(language)),
    };
  }

  async list(
    principal: Principal | null,
    query: ProblemListQueryDto,
  ): Promise<Paginated<ProblemListItemResponse>> {
    const { items, total } = await this.repository.list(
      await this.listFilter(principal, query),
      listSort(query.sort),
      query.page,
      query.pageSize,
    );
    const statuses = await this.viewerStatusesOf(
      principal,
      items.map((problem) => problem._id),
    );
    const catalog = {
      lang: query.lang,
      types: this.types,
      groups: this.groups,
    };
    return new Paginated(
      items.map((problem) =>
        ProblemListItemResponse.from(
          problem,
          catalog,
          statuses.get(problem._id) ?? null,
        ),
      ),
      { page: query.page, pageSize: query.pageSize, total },
    );
  }

  private async contestContext(
    current: CurrentParticipation | null,
    problem: ProblemDocument,
  ): Promise<ProblemContestResponse | null> {
    const entry = current?.contest.problems.find(
      (candidate) => uuidStr(candidate.problem) === problem._id,
    );
    if (!current || !entry) return null;
    if (entry.maxSubmissions === null)
      return { contestKey: current.contest.key, attemptsLeft: null };
    const attempts = await this.participations.countAttempts(
      current.participation._id,
      problem._id,
    );
    return {
      contestKey: current.contest.key,
      attemptsLeft: Math.max(0, entry.maxSubmissions - attempts),
    };
  }

  async detail(
    principal: Principal | null,
    code: string,
    lang: StatementLanguage,
  ): Promise<ProblemDetailResponse> {
    const current = await this.currentContest.current(principal);
    const scope = this.currentContest.scopeFrom(current);
    const problem = await this.visibleUnder(principal, code, scope);
    const canEdit = this.canEdit(principal, problem);
    const personIds = [...problem.authors];
    if (canEdit)
      personIds.push(
        ...problem.curators,
        ...problem.testers,
        ...problem.bannedUsers,
        ...(problem.solution?.authors ?? []),
        ...(problem.suggester ? [problem.suggester] : []),
      );
    const people = new Map(
      (await this.users.findByIds([...new Set(personIds.map(uuidStr))])).map(
        (user) => [user._id, user],
      ),
    );
    return ProblemDetailResponse.from(problem, {
      lang,
      canEdit,
      hasEditorial: this.editorialReadable(principal, problem, scope),
      viewerStatus:
        (await this.viewerStatusesOf(principal, [problem._id])).get(
          problem._id,
        ) ?? null,
      contest: await this.contestContext(current, problem),
      people,
      types: this.types,
      groups: this.groups,
      licenses: this.licenses,
      languages: this.languages,
    });
  }

  async editorial(
    principal: Principal | null,
    code: string,
    lang: StatementLanguage,
  ): Promise<EditorialResponse> {
    const scope = await this.currentContest.scopeOf(principal);
    const problem = await this.visibleUnder(principal, code, scope);
    const canEdit = this.canEdit(principal, problem);
    const { solution } = problem;
    if (!solution || !this.editorialReadable(principal, problem, scope))
      throw new AppError('not_found', 404, 'No such editorial');
    const authors = (
      await this.users.findByIds(solution.authors.map(uuidStr))
    ).map((user) => UserSummaryResponse.from(user));
    return EditorialResponse.from(problem, solution, {
      lang,
      authors,
      canEdit,
    });
  }

  /** 404 for malformed, unknown and invisible codes alike, so existence never leaks. */
  async visibleProblem(
    principal: Principal | null,
    code: string,
  ): Promise<ProblemDocument> {
    return this.visibleUnder(
      principal,
      code,
      await this.currentContest.scopeOf(principal),
    );
  }

  /** Ignores the viewer's current contest (legacy `skip_contest_problem_check`; legacy edit views check `is_editable_by` only). */
  visibleProblemOutsideContest(
    principal: Principal | null,
    code: string,
  ): Promise<ProblemDocument> {
    return this.visibleUnder(principal, code, null);
  }

  private async visibleUnder(
    principal: Principal | null,
    code: string,
    scope: ContestScope | null,
  ): Promise<ProblemDocument> {
    const problem = PROBLEM_CODE_PATTERN.test(code)
      ? await this.repository.findByCode(code)
      : null;
    if (
      !problem ||
      !ProblemAccess.canSee(principal, ProblemAccess.accessView(problem), scope)
    )
      throw new AppError('not_found', 404, 'No such problem');
    return problem;
  }

  /** The one editorial rule (page, detail flag, comments): legacy `ProblemSolution` is a 404 for anyone in a contest, and the problem itself must be visible. */
  editorialReadable(
    principal: Principal | null,
    problem: Problem,
    scope: ContestScope | null,
  ): boolean {
    return (
      scope === null &&
      ProblemAccess.canSee(
        principal,
        ProblemAccess.accessView(problem),
        null,
      ) &&
      this.editorialVisible(
        principal,
        problem,
        this.canEdit(principal, problem),
      )
    );
  }

  private editorialVisible(
    principal: Principal | null,
    problem: Problem,
    canEdit: boolean,
  ): boolean {
    const { solution } = problem;
    if (!solution) return false;
    return (
      isEditorialPublished(solution) ||
      (principal !== null &&
        hasPermission(principal, 'judge.see_private_solution')) ||
      canEdit
    );
  }

  /** Anonymous viewers cost no query. */
  private viewerStatusesOf(
    principal: Principal | null,
    problemIds: string[],
  ): Promise<Map<string, ViewerMark>> {
    return principal
      ? this.viewerStatuses.statusesOf(principal.userId, problemIds)
      : Promise.resolve(new Map<string, ViewerMark>());
  }

  private canEdit(principal: Principal | null, problem: Problem): boolean {
    return ProblemAccess.canEdit(principal, ProblemAccess.accessView(problem));
  }

  private async listFilter(
    principal: Principal | null,
    query: ProblemListQueryDto,
  ): Promise<FilterQuery<Problem>> {
    const clauses: FilterQuery<Problem>[] = [
      ProblemAccess.visibleFilter(
        principal,
        await this.currentContest.scopeOf(principal),
      ),
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
    if (query.solved !== undefined) {
      const solved = principal
        ? await this.viewerStatuses.solvedIds(principal.userId)
        : [];
      clauses.push(
        query.solved ? { _id: { $in: solved } } : { _id: { $nin: solved } },
      );
    }
    const search = query.search?.trim();
    if (search) clauses.push(searchFilter(search));
    return { $and: clauses };
  }
}
