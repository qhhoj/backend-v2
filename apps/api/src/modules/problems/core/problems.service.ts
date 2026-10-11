import { Injectable } from '@nestjs/common';
import { hasPermission, UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError, Paginated } from '@libs/common';
import {
  compareLanguages,
  narrowTo,
  PROBLEM_CODE_PATTERN,
  uuidStr,
} from '@libs/database';
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
import {
  ProblemListQueryDto,
  ProblemFilterQueryDto,
} from './dto/problem-list.dto';
import {
  ProblemListItemResponse,
  RandomProblemResponse,
} from './dto/problem-list.response';
import { ProblemAccess } from './problem-access';
import type { ContestScope } from './problem-access';
import {
  isEditorialPublished,
  listSort,
  publicEditorialFilter,
  searchFilter,
  substringFilter,
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

/** `search` (every word a substring, accent-insensitive) and `q` (substring), both optional and both applied. */
function textClauses(query: ProblemFilterQueryDto): FilterQuery<Problem>[] {
  const search = query.search?.trim();
  const substring = query.q?.trim();
  return [
    ...(search ? [searchFilter(search)] : []),
    ...(substring ? [substringFilter(substring)] : []),
  ];
}

/** Pending suggestions: legacy `is_suggesting` (a suggester, not yet public). */
const SUGGESTED_FILTER: FilterQuery<Problem> = {
  suggester: { $ne: null },
  isPublic: false,
};

/** The admin list's person and review-queue filters; curators stay private, so only full editors may match on them. */
function staffClauses(
  principal: Principal | null,
  query: ProblemFilterQueryDto,
): FilterQuery<Problem>[] {
  const clauses: FilterQuery<Problem>[] = [];
  if (query.authorId) {
    const seesCurators =
      principal !== null && hasPermission(principal, 'judge.edit_all_problem');
    clauses.push(
      seesCurators
        ? { $or: [{ authors: query.authorId }, { curators: query.authorId }] }
        : { authors: query.authorId },
    );
  }
  if (query.suggested !== undefined)
    clauses.push(
      query.suggested ? SUGGESTED_FILTER : { $nor: [SUGGESTED_FILTER] },
    );
  return clauses;
}

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
        .sort(compareLanguages)
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
    const [statuses, authorsOf] = await Promise.all([
      this.viewerStatusesOf(
        principal,
        items.map((problem) => problem._id),
      ),
      this.authorSummaries(items),
    ]);
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
          authorsOf(problem),
        ),
      ),
      { page: query.page, pageSize: query.pageSize, total },
    );
  }

  /** One user lookup for a whole page; returns each problem's author summaries in stored order. */
  private async authorSummaries(
    problems: ProblemDocument[],
  ): Promise<(problem: ProblemDocument) => UserSummaryResponse[]> {
    const ids = [
      ...new Set(problems.flatMap((problem) => problem.authors.map(uuidStr))),
    ];
    const users = new Map(
      (await this.users.findByIds(ids)).map((user) => [
        user._id,
        UserSummaryResponse.from(user),
      ]),
    );
    return (problem) =>
      problem.authors.flatMap((id) => users.get(uuidStr(id)) ?? []);
  }

  /** Same filters and visibility as `list`; 404 when nothing matches. */
  async randomCode(
    principal: Principal | null,
    query: ProblemFilterQueryDto,
  ): Promise<RandomProblemResponse> {
    const code = await this.repository.randomCode(
      await this.listFilter(principal, query),
    );
    if (!code) throw new AppError('no_problem', 404, 'No matching problem');
    return { code };
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
    query: ProblemFilterQueryDto,
  ): Promise<FilterQuery<Problem>> {
    // An editor edits outside any contest (`editableProblem`), so the editable index ignores the current contest's scope.
    const scope = query.editable
      ? null
      : await this.currentContest.scopeOf(principal);
    const clauses: FilterQuery<Problem>[] = [
      ProblemAccess.visibleFilter(principal, scope),
    ];
    if (query.visibility !== 'all')
      clauses.push({ isPublic: query.visibility === 'public' });
    if (query.editable !== undefined)
      clauses.push(
        narrowTo(ProblemAccess.editableFilter(principal), query.editable),
      );
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
    clauses.push(...staffClauses(principal, query));
    if (query.solved !== undefined) {
      const solved = principal
        ? await this.viewerStatuses.solvedIds(principal.userId)
        : [];
      clauses.push(
        query.solved ? { _id: { $in: solved } } : { _id: { $nin: solved } },
      );
    }
    return { $and: [...clauses, ...textClauses(query)] };
  }
}
