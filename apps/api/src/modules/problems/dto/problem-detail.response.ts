import type { UserDocument } from '@libs/auth';
import { uuidStr } from '@libs/database';
import type { StatementLanguage } from '@libs/database';
import { LanguagesQuerier } from '../languages.querier';
import { LicensesQuerier } from '../licenses.querier';
import { ProblemGroupsQuerier } from '../problem-groups.querier';
import { ProblemTypesQuerier } from '../problem-types.querier';
import type { ProblemDocument } from '../problems.repository';
import { statementFor } from '../statement';
import {
  CatalogItemResponse,
  LanguageResponse,
  LicenseResponse,
} from './problem-meta.response';
import { UserSummaryResponse } from './user-summary.response';

export interface ProblemDetailContext {
  lang: StatementLanguage;
  canEdit: boolean;
  hasEditorial: boolean;
  people: Map<string, UserDocument>;
  types: ProblemTypesQuerier;
  groups: ProblemGroupsQuerier;
  licenses: LicensesQuerier;
  languages: LanguagesQuerier;
}

type Summaries = (ids: unknown[]) => UserSummaryResponse[];

export class ProblemEditorResponse {
  description!: string;
  translations!: Array<{
    language: StatementLanguage;
    name: string;
    description: string;
  }>;
  solution!: {
    isPublic: boolean;
    publishOn: string;
    authors: UserSummaryResponse[];
    content: string;
  } | null;
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

export class ProblemDetailResponse {
  id!: string;
  code!: string;
  name!: string;
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
  languageLimits!: Array<{
    language: string;
    timeLimit: number;
    memoryLimit: number;
  }>;
  pdfStatementUrl!: string | null;
  materialUrl!: string | null;
  availableTranslations!: StatementLanguage[];
  hasEditorial!: boolean;
  submissionSourceVisibility!: string;
  testcaseVisibility!: string;
  testcaseResultVisibility!: string;
  allowViewFeedback!: boolean;
  userCount!: number;
  acRate!: number;
  canEdit!: boolean;
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
        .map(UserSummaryResponse.from);
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
        .map(CatalogItemResponse.from),
      group: group && CatalogItemResponse.from(group),
      license: license && LicenseResponse.from(license),
      authors: summaries(problem.authors),
      allowedLanguages: context.languages
        .byIds(problem.allowedLanguages.map(uuidStr))
        .map(LanguageResponse.from),
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
      editor: context.canEdit
        ? ProblemEditorResponse.from(problem, summaries)
        : null,
    };
  }
}
