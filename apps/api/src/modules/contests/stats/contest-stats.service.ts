import { Injectable } from '@nestjs/common';
import type { Principal } from '@libs/auth';
import { AppError } from '@libs/common';
import { problemLabel } from '@libs/contests';
import { uuidStr } from '@libs/database';
import type { SubmissionResult } from '@libs/database';
import { LanguagesQuerier } from '../../problems/languages.querier';
import { ProblemsRepository } from '../../problems/problems.repository';
import { ContestAccess } from '../core/contest-access';
import { ContestStatsRepository } from './contest-stats.repository';
import { ContestViewerService } from '../core/contest-viewer.service';
import { ContestsService } from '../core/contests.service';
import type { ContestStatsResponse } from './dto/contest-stats.response';

const ERROR_RESULTS: readonly SubmissionResult[] = [
  'MLE',
  'OLE',
  'IR',
  'RTE',
  'AB',
  'IE',
];
const percent = (accepted: number, total: number) =>
  total ? (100 * accepted) / total : 0;

type CountRows = Awaited<ReturnType<ContestStatsRepository['countsBy']>>;
const countOf = (
  rows: CountRows,
  key: string,
  results: readonly SubmissionResult[] | null,
) =>
  rows
    .filter(
      (row) =>
        row.key === key &&
        (results === null || (row.result && results.includes(row.result))),
    )
    .reduce((sum, row) => sum + row.count, 0);

/** Legacy `ContestStats`: result counts per problem and per language. */
@Injectable()
export class ContestStatsService {
  constructor(
    private readonly contestsService: ContestsService,
    private readonly viewers: ContestViewerService,
    private readonly stats: ContestStatsRepository,
    private readonly problems: ProblemsRepository,
    private readonly languages: LanguagesQuerier,
  ) {}

  async statsOf(
    principal: Principal | null,
    key: string,
    now = new Date(),
  ): Promise<ContestStatsResponse> {
    const contest = await this.contestsService.visibleContest(principal, key);
    const viewer = await this.viewers.viewerOf(principal, contest, now);
    if (
      !ContestAccess.canSeeFullSubmissionList(
        principal,
        ContestAccess.accessView(contest),
        now,
        viewer,
      )
    )
      throw new AppError(
        'forbidden',
        403,
        'The statistics of this contest are hidden',
      );
    const [byProblem, byLanguage] = await Promise.all([
      this.stats.countsBy(contest._id, contest.startTime, 'problem'),
      this.stats.countsBy(contest._id, contest.startTime, 'language'),
    ]);
    const ordered = [...contest.problems].sort(
      (left, right) => left.order - right.order,
    );
    const summaries = new Map(
      (
        await this.problems.findSummaries(
          ordered.map((entry) => uuidStr(entry.problem)),
        )
      ).map((problem) => [problem._id, problem]),
    );
    return {
      problems: ordered.map((entry, index) => {
        const problemId = uuidStr(entry.problem);
        const total = countOf(byProblem, problemId, null);
        const accepted = countOf(byProblem, problemId, ['AC']);
        return {
          problemId,
          code: summaries.get(problemId)?.code ?? '',
          name: summaries.get(problemId)?.name ?? '',
          label: problemLabel(index, contest.labelStyle),
          results: {
            AC: accepted,
            WA: countOf(byProblem, problemId, ['WA']),
            CE: countOf(byProblem, problemId, ['CE']),
            TLE: countOf(byProblem, problemId, ['TLE']),
            ERR: countOf(byProblem, problemId, ERROR_RESULTS),
            RJ: countOf(byProblem, problemId, ['RJ']),
          },
          total,
          acRate: percent(accepted, total),
        };
      }),
      languages: [...new Set(byLanguage.map((row) => row.key))]
        .map((languageId) => {
          const count = countOf(byLanguage, languageId, null);
          return {
            languageId,
            name: this.languages.byId(languageId)?.name ?? '',
            count,
            acRate: percent(countOf(byLanguage, languageId, ['AC']), count),
          };
        })
        .sort((left, right) => right.count - left.count),
    };
  }
}
