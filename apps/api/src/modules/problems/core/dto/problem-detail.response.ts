import type { UserDocument } from '@libs/auth';
import { STATEMENT_LANGUAGES, uuidStr } from '@libs/database';
import type { StatementLanguage } from '@libs/database';
import { ApiProperty } from '@nestjs/swagger';
import { LanguagesQuerier } from '../../catalog/languages.querier';
import { LicensesQuerier } from '../../catalog/licenses.querier';
import { ProblemGroupsQuerier } from '../../catalog/problem-groups.querier';
import { ProblemTypesQuerier } from '../../catalog/problem-types.querier';
import type { ProblemDocument } from '../problems.repository';
import { statementFor } from '@libs/problems';
import {
  CatalogItemResponse,
  LanguageResponse,
  LicenseResponse,
} from './problem-meta.response';
import { UserSummaryResponse } from './user-summary.response';
import type { ViewerStatus } from '../viewer-status.repository';

export interface ProblemDetailContext {
  lang: StatementLanguage;
  canEdit: boolean;
  hasEditorial: boolean;
  viewerStatus: ViewerStatus;
  contest: ProblemContestResponse | null;
  people: Map<string, UserDocument>;
  types: ProblemTypesQuerier;
  groups: ProblemGroupsQuerier;
  licenses: LicensesQuerier;
  languages: LanguagesQuerier;
}

type Summaries = (ids: unknown[]) => UserSummaryResponse[];

export class LanguageLimitResponse {
  language!: string;
  timeLimit!: number;
  memoryLimit!: number;
}

export class ProblemTranslationResponse {
  @ApiProperty({ enum: STATEMENT_LANGUAGES, enumName: 'StatementLanguage' })
  language!: StatementLanguage;
  name!: string;
  description!: string;
}

export class ProblemEditorialDraftResponse {
  isPublic!: boolean;
  publishOn!: string;
  authors!: UserSummaryResponse[];
  content!: string;
}

export class ProblemEditorResponse {
  description!: string;
  translations!: ProblemTranslationResponse[];
  solution!: ProblemEditorialDraftResponse | null;
  curators!: UserSummaryResponse[];
  testers!: UserSummaryResponse[];
  bannedUsers!: UserSummaryResponse[];
  suggester!: UserSummaryResponse | null;
  typeIds!: string[];
  groupId!: string;
  licenseId!: string | null;
  allowedLanguageIds!: string[];
  organizations!: string[];

  static from(
    problem: ProblemDocument,
    summaries: Summaries,
  ): ProblemEditorResponse {
    const { solution } = problem;
    return {
      description: problem.description,
      translations: problem.translations.map(
        ({ language, name, description }) => ({ language, name, description }),
      ),
      solution: solution && {
        isPublic: solution.isPublic,
        publishOn: solution.publishOn.toISOString(),
        authors: summaries(solution.authors),
        content: solution.content,
      },
      curators: summaries(problem.curators),
      testers: summaries(problem.testers),
      bannedUsers: summaries(problem.bannedUsers),
      suggester:
        problem.suggester == null
          ? null
          : (summaries([problem.suggester])[0] ?? null),
      typeIds: problem.typeIds.map(uuidStr),
      groupId: uuidStr(problem.groupId),
      licenseId: problem.licenseId === null ? null : uuidStr(problem.licenseId),
      allowedLanguageIds: problem.allowedLanguages.map(uuidStr),
      organizations: problem.organizations.map(uuidStr),
    };
  }
}

export class ProblemContestResponse {
  contestKey!: string;
  /** Null when the contest problem has no `maxSubmissions`. */
  attemptsLeft!: number | null;
}

export class ProblemDetailResponse {
  id!: string;
  code!: string;
  name!: string;
  @ApiProperty({ enum: STATEMENT_LANGUAGES, enumName: 'StatementLanguage' })
  language!: StatementLanguage;
  translated!: boolean;
  descriptionHtml!: string;
  source!: string;
  summary!: string;
  timeLimit!: number;
  memoryLimit!: number;
  points!: number;
  partial!: boolean;
  date!: string | null;
  isPublic!: boolean;
  isOrganizationPrivate!: boolean;
  organizations!: string[];
  isManuallyManaged!: boolean;
  isFullMarkup!: boolean;
  types!: CatalogItemResponse[];
  group!: CatalogItemResponse | null;
  license!: LicenseResponse | null;
  authors!: UserSummaryResponse[];
  allowedLanguages!: LanguageResponse[];
  languageLimits!: LanguageLimitResponse[];
  pdfStatementUrl!: string | null;
  materialUrl!: string | null;
  @ApiProperty({
    enum: STATEMENT_LANGUAGES,
    enumName: 'StatementLanguage',
    isArray: true,
  })
  availableTranslations!: StatementLanguage[];
  hasEditorial!: boolean;
  submissionSourceVisibility!: string;
  testcaseVisibility!: string;
  testcaseResultVisibility!: string;
  allowViewFeedback!: boolean;
  userCount!: number;
  acRate!: number;
  canEdit!: boolean;
  /** For the signed-in viewer; null when anonymous or never submitted. */
  viewerStatus!: ViewerStatus;
  /** The viewer's current contest when it lists this problem. */
  contest!: ProblemContestResponse | null;
  editor!: ProblemEditorResponse | null;

  static from(
    problem: ProblemDocument,
    context: ProblemDetailContext,
  ): ProblemDetailResponse {
    const statement = statementFor(problem, context.lang);
    const summaries: Summaries = (ids) =>
      ids
        .map(uuidStr)
        .flatMap((id) => context.people.get(id) ?? [])
        .map((user) => UserSummaryResponse.from(user));
    const group = context.groups.byId(uuidStr(problem.groupId));
    const license =
      problem.licenseId === null
        ? null
        : context.licenses.byId(uuidStr(problem.licenseId));
    return {
      id: problem._id,
      code: problem.code,
      name: statement.name,
      language: statement.language,
      translated: statement.translated,
      descriptionHtml: statement.descriptionHtml,
      source: problem.source,
      summary: problem.summary,
      timeLimit: problem.timeLimit,
      memoryLimit: problem.memoryLimit,
      points: problem.points,
      partial: problem.partial,
      date: problem.date?.toISOString() ?? null,
      isPublic: problem.isPublic,
      isOrganizationPrivate: problem.isOrganizationPrivate,
      organizations: problem.organizations.map(uuidStr),
      isManuallyManaged: problem.isManuallyManaged,
      isFullMarkup: problem.isFullMarkup,
      types: context.types
        .byIds(problem.typeIds.map(uuidStr))
        .map((item) => CatalogItemResponse.from(item)),
      group: group && CatalogItemResponse.from(group),
      license: license && LicenseResponse.from(license),
      authors: summaries(problem.authors),
      allowedLanguages: context.languages
        .byIds(problem.allowedLanguages.map(uuidStr))
        .map((language) => LanguageResponse.from(language)),
      languageLimits: problem.languageLimits.flatMap((limit) => {
        const language = context.languages.byId(uuidStr(limit.languageId));
        return language
          ? [
              {
                language: language.key,
                timeLimit: limit.timeLimit,
                memoryLimit: limit.memoryLimit,
              },
            ]
          : [];
      }),
      pdfStatementUrl: problem.pdfStatementUrl,
      materialUrl: problem.materialUrl,
      availableTranslations: problem.translations.map(
        (translation) => translation.language,
      ),
      hasEditorial: context.hasEditorial,
      submissionSourceVisibility: problem.submissionSourceVisibility,
      testcaseVisibility: problem.testcaseVisibility,
      testcaseResultVisibility: problem.testcaseResultVisibility,
      allowViewFeedback: problem.allowViewFeedback,
      userCount: problem.userCount,
      acRate: problem.acRate,
      canEdit: context.canEdit,
      viewerStatus: context.viewerStatus,
      contest: context.contest,
      editor: context.canEdit
        ? ProblemEditorResponse.from(problem, summaries)
        : null,
    };
  }
}
