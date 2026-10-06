import { Injectable } from '@nestjs/common';
import { UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError, unique } from '@libs/common';
import { uuidStr } from '@libs/database';
import type { Submission } from '@libs/database';
import { LanguagesQuerier } from '../problems/languages.querier';
import { ProblemsRepository } from '../problems/problems.repository';
import { caseVisibility } from '../submissions/submission-access';
import { SubmissionsRepository } from '../submissions/submissions.repository';
import { SubmissionsService } from '../submissions/submissions.service';
import { ApiV2SubmissionListDto } from './dto/api-v2-submission-list.dto';
import { legacyCases } from './legacy-cases';
import {
  API_V2_PAGE_SIZE,
  isoformat,
  legacyInfinitePage,
  legacyPage,
  legacyTotalPages,
} from './legacy-envelope';
import type { LegacyInfinitePage, LegacyPage } from './legacy-envelope';

const notFound = () => new AppError('not_found', 404, 'page/object not found');

@Injectable()
export class ApiV2SubmissionsService {
  constructor(
    private readonly submissions: SubmissionsService,
    private readonly repository: SubmissionsRepository,
    private readonly problems: ProblemsRepository,
    private readonly users: UsersRepository,
    private readonly languages: LanguagesQuerier,
  ) {}

  /** Legacy `APISubmissionList`: visible problems only, oldest first; a `user` or `problem` filter gives a counted page, none gives an infinite one. */
  async list(
    principal: Principal | null,
    query: ApiV2SubmissionListDto,
  ): Promise<
    | LegacyPage<Record<string, unknown>>
    | LegacyInfinitePage<Record<string, unknown>>
  > {
    const filter = await this.filterOf(principal, query);
    const skip = (query.page - 1) * API_V2_PAGE_SIZE;
    if (query.user !== undefined || query.problem !== undefined) {
      const total = filter ? await this.repository.countMatching(filter) : 0;
      if (query.page > legacyTotalPages(total)) throw notFound();
      const items = filter
        ? await this.repository.findPage(filter, skip, API_V2_PAGE_SIZE)
        : [];
      return legacyPage(await this.rows(items), query.page, total);
    }
    const items = filter
      ? await this.repository.findPage(filter, skip, API_V2_PAGE_SIZE + 1)
      : [];
    if (query.page > 1 && !items.length) throw notFound();
    return legacyInfinitePage(
      await this.rows(items.slice(0, API_V2_PAGE_SIZE)),
      query.page,
      items.length > API_V2_PAGE_SIZE,
    );
  }

  /** Legacy `APISubmissionDetail`: `can_see_detail`, cases grouped like the status page and shown as `/api/internal` shows them. */
  async detail(
    principal: Principal,
    id: string,
  ): Promise<Record<string, unknown>> {
    const { submission, problem, canEdit } = await this.submissions.viewable(
      principal,
      id,
    );
    const shown = caseVisibility(principal, problem, canEdit).cases;
    const withCases =
      shown === 'none'
        ? submission
        : ((await this.repository.findById(id, true)) ?? submission);
    const [owner] = await this.users.findByIds([uuidStr(submission.user)]);
    return {
      id: uuidStr(submission._id),
      problem: problem.code,
      user: owner?.username ?? null,
      date: isoformat(submission.date),
      time: submission.time,
      memory: submission.memory,
      points: submission.points,
      language: this.languages.byId(uuidStr(submission.language))?.key ?? null,
      status: submission.status,
      result: submission.result,
      case_points: submission.casePoints,
      case_total: submission.caseTotal,
      cases: legacyCases(withCases.cases ?? [], shown),
    };
  }

  /** Legacy filters resolve to nothing when the user, problem or every language key is unknown (`user = None`, `language_id__in []`). */
  private async filterOf(
    principal: Principal | null,
    query: ApiV2SubmissionListDto,
  ) {
    const languageIds = query.language
      ? this.languages
          .all()
          .filter((language) => query.language!.includes(language.key))
          .map((language) => language._id)
      : undefined;
    if (languageIds && !languageIds.length) return null;
    return this.submissions.filterFor(principal, {
      user: query.user,
      problem: query.problem,
      language: languageIds,
      result: query.result,
    });
  }

  private async rows(
    items: Submission[],
  ): Promise<Array<Record<string, unknown>>> {
    const [users, problems] = await Promise.all([
      this.users.findByIds(unique(items.map((item) => uuidStr(item.user)))),
      this.problems.findSummaries(
        unique(items.map((item) => uuidStr(item.problem))),
      ),
    ]);
    const usernameOf = new Map(users.map((user) => [user._id, user.username]));
    const codeOf = new Map(
      problems.map((problem) => [problem._id, problem.code]),
    );
    return items.map((submission) => ({
      id: uuidStr(submission._id),
      problem: codeOf.get(uuidStr(submission.problem)) ?? null,
      user: usernameOf.get(uuidStr(submission.user)) ?? null,
      date: isoformat(submission.date),
      language: this.languages.byId(uuidStr(submission.language))?.key ?? null,
      time: submission.time,
      memory: submission.memory,
      points: submission.points,
      result: submission.result,
    }));
  }
}
