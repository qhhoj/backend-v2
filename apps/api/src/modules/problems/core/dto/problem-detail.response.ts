import type { UserDocument } from '@libs/auth';
import {
  compareLanguages,
  isLanguageActive,
  STATEMENT_LANGUAGES,
  uuidStr,
} from '@libs/database';
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
import {
  ApiSubmissionSourceVisibility,
  ApiTestcaseResultVisibility,
  ApiTestcaseVisibility,
} from './problem-visibility';
import { UserSummaryResponse } from './user-summary.response';
import { VIEWER_MARKS, type ViewerStatus } from '../viewer-status.repository';

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
  /** Language key. */
  language!: string;
  /** Time limit in seconds for this language. */
  timeLimit!: number;
  /** Memory limit in KiB for this language. */
  memoryLimit!: number;
}

export class ProblemTranslationResponse {
  /** Language of the translation. */
  @ApiProperty({ enum: STATEMENT_LANGUAGES, enumName: 'StatementLanguage' })
  language!: StatementLanguage;
  /** Translated title. */
  name!: string;
  /** Translated statement in markdown. */
  description!: string;
}

export class ProblemEditorialDraftResponse {
  /** Whether the editorial is marked public. */
  isPublic!: boolean;
  /** When it becomes readable by everyone (ISO 8601). */
  publishOn!: string;
  /** Editorial authors. */
  authors!: UserSummaryResponse[];
  /** Editorial markdown. */
  content!: string;
}

export class ProblemEditorResponse {
  /** The base (default-language) name, whatever `lang` the detail was read in; the detail's own `name` follows `lang`. */
  baseName!: string;
  /** Base-language statement in markdown. */
  description!: string;
  /** Statement translations. */
  translations!: ProblemTranslationResponse[];
  /** The editorial draft; null when none. */
  solution!: ProblemEditorialDraftResponse | null;
  /** Users who can edit the problem. */
  curators!: UserSummaryResponse[];
  /** Users who can see the problem while it is private. */
  testers!: UserSummaryResponse[];
  /** Users who may not submit. */
  bannedUsers!: UserSummaryResponse[];
  /** User who suggested the problem; null if it was not suggested. */
  suggester!: UserSummaryResponse | null;
  /** Problem type ids. */
  typeIds!: string[];
  /** Problem group id. */
  groupId!: string;
  /** License id; null when none. */
  licenseId!: string | null;
  /** Ids of languages solutions may use. */
  allowedLanguageIds!: string[];
  /** Ids of the organizations the problem is private to. */
  organizations!: string[];
  /** Image URL used for link previews; empty when none. */
  ogImage!: string;

  static from(
    problem: ProblemDocument,
    summaries: Summaries,
  ): ProblemEditorResponse {
    const { solution } = problem;
    return {
      baseName: problem.name,
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
      ogImage: problem.ogImage,
    };
  }
}

export class ProblemContestResponse {
  /** Key of the viewer's current contest. */
  contestKey!: string;
  /** Null when the contest problem has no `maxSubmissions`. */
  attemptsLeft!: number | null;
}

export class ProblemExternalJudgeBadgeResponse {
  /** The external judge's OJ the problem is judged on (`CodeForces`, `QOJ`, ...). */
  oj!: string;
}

export class ProblemDetailResponse {
  /** Problem id. */
  id!: string;
  /** Problem code, unique and used in URLs. */
  code!: string;
  /** Title in the returned `language`. */
  name!: string;
  /** Language of the returned statement. */
  @ApiProperty({ enum: STATEMENT_LANGUAGES, enumName: 'StatementLanguage' })
  language!: StatementLanguage;
  /** True when the statement is in the requested language (the base language counts); false when it fell back to the base statement. */
  translated!: boolean;
  /** Rendered statement HTML. */
  descriptionHtml!: string;
  /** Where the problem comes from (contest or author credit). */
  source!: string;
  /** Short summary for previews. */
  summary!: string;
  /** Default time limit in seconds. */
  timeLimit!: number;
  /** Default memory limit in KiB. */
  memoryLimit!: number;
  /** Points the problem is worth. */
  points!: number;
  /** Whether partial scores are given. */
  partial!: boolean;
  /** Publication date (ISO 8601); null when unset. */
  date!: string | null;
  /** Whether the problem is public. */
  isPublic!: boolean;
  /** Whether only members of the listed organizations can see it. */
  isOrganizationPrivate!: boolean;
  /** Ids of those organizations. */
  organizations!: string[];
  /** Whether test data is managed outside the site (the data editor is off). */
  isManuallyManaged!: boolean;
  /** Whether the statement may contain unsanitized HTML. */
  isFullMarkup!: boolean;
  /** Problem types. */
  types!: CatalogItemResponse[];
  /** Problem group; null when none. */
  group!: CatalogItemResponse | null;
  /** License; null when none. */
  license!: LicenseResponse | null;
  /** Problem authors. */
  authors!: UserSummaryResponse[];
  /** Languages solutions may use. */
  allowedLanguages!: LanguageResponse[];
  /** Per-language limits overriding the defaults. */
  languageLimits!: LanguageLimitResponse[];
  /** URL of the uploaded PDF statement; null when none. */
  pdfStatementUrl!: string | null;
  /** URL of the downloadable material; null when none. */
  materialUrl!: string | null;
  /** Languages with a translated statement. */
  @ApiProperty({
    enum: STATEMENT_LANGUAGES,
    enumName: 'StatementLanguage',
    isArray: true,
  })
  availableTranslations!: StatementLanguage[];
  /** Whether the viewer can read an editorial. */
  hasEditorial!: boolean;
  /** Who may read submitted sources: `F` follow the site setting, `A` everyone who sees the problem, `S` users who solved it, `O` only the owner, testers and editors. */
  @ApiSubmissionSourceVisibility()
  submissionSourceVisibility!: string;
  /** When program output of test cases is shown to non-editors: `O` never, `C` outside contests, `A` always. */
  @ApiTestcaseVisibility()
  testcaseVisibility!: string;
  /** How much of the test case results is shown: `A` every case, `B` batch summaries, `S` totals only. */
  @ApiTestcaseResultVisibility()
  testcaseResultVisibility!: string;
  /** Whether checker feedback is shown to submitters. */
  allowViewFeedback!: boolean;
  /** Number of users who solved the problem. */
  userCount!: number;
  /** Percentage of accepted submissions, 0 to 100. */
  acRate!: number;
  /** Whether the viewer can edit the problem. */
  canEdit!: boolean;
  /** For the signed-in viewer; null when anonymous or never submitted. */
  @ApiProperty({ enum: VIEWER_MARKS, nullable: true })
  viewerStatus!: ViewerStatus;
  /** The viewer's current contest when it lists this problem. */
  contest!: ProblemContestResponse | null;
  /** Where the problem is judged when an external judge does it; null for judge-v2. */
  externalJudge!: ProblemExternalJudgeBadgeResponse | null;
  /** Raw fields for the editor; null unless `canEdit`. */
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
        .filter(isLanguageActive)
        .sort(compareLanguages)
        .map((language) => LanguageResponse.from(language)),
      languageLimits: problem.languageLimits.flatMap((limit) => {
        const language = context.languages.byId(uuidStr(limit.languageId));
        return language && isLanguageActive(language)
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
      externalJudge: problem.externalJudge?.isActive
        ? { oj: problem.externalJudge.oj }
        : null,
      editor: context.canEdit
        ? ProblemEditorResponse.from(problem, summaries)
        : null,
    };
  }
}
