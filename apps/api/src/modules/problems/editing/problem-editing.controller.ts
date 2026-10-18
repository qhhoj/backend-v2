import {
  Body,
  Controller,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentAuth, RequirePermission } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { RefuseNullFieldsPipe, RenderPreviewResponse } from '@libs/common';
import { CloneProblemDto } from './dto/clone.dto';
import { PutEditorialDto } from './dto/editorial.dto';
import { ProblemCodeParamDto } from '../core/dto/problem-params.dto';
import { RenderPreviewDto } from './dto/render-preview.dto';
import { PutTranslationDto, TranslationParamsDto } from './dto/translation.dto';
import { CreateProblemDto, UpdateProblemDto } from './dto/problem-edit.dto';
import { ProblemDetailResponse } from '../core/dto/problem-detail.response';
import { ProblemCloneService } from './problem-clone.service';
import { ProblemEditingService } from './problem-editing.service';
import { ProblemStatementEditingService } from './problem-statement-editing.service';

@ApiTags('Problem editing')
@Controller('api/internal/problems')
export class ProblemEditingController {
  constructor(
    private readonly editing: ProblemEditingService,
    private readonly statements: ProblemStatementEditingService,
    private readonly clones: ProblemCloneService,
  ) {}

  /**
   * Create a problem
   *
   * @remarks
   * Needs `judge.add_problem`. The creator becomes a curator. Some fields are
   * gated: `isPublic` needs `judge.change_public_visibility`,
   * `isManuallyManaged` needs `judge.change_manually_managed`, `isFullMarkup`
   * needs `judge.problem_full_markup`, people, licence, organizations and other
   * staff fields need `judge.edit_all_problem`, and a time limit above 5 seconds
   * needs `judge.high_problem_timelimit` (400 `time_limit_too_high`). Writes a
   * revision, charges the organization's quota for organization-private problems
   * (403 `quota_exceeded`) and returns the new problem as `GET /problems/{code}`
   * would. A taken or reserved code is 400 `code_taken`.
   */
  @RequirePermission('judge.add_problem')
  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CreateProblemDto,
  ): Promise<ProblemDetailResponse> {
    return this.editing.create(auth, body, 'create');
  }

  /**
   * Suggest a problem for review
   *
   * @remarks
   * Needs `judge.suggest_new_problem`. Same body as creating a problem, but the
   * problem is stored private with the caller as its suggester and is announced
   * to the configured Discord webhook for review. Suggested problems stay
   * visible to their suggester and to reviewers until published.
   */
  @RequirePermission('judge.suggest_new_problem')
  @Post('suggest')
  suggest(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CreateProblemDto,
  ): Promise<ProblemDetailResponse> {
    return this.editing.create(auth, body, 'suggest');
  }

  /**
   * Update a problem
   *
   * @remarks
   * Needs edit rights on the problem (404 `not_found` when it is invisible to
   * the caller, 403 `forbidden` when visible but not editable). Send only the
   * fields to change; `licenseId` and `date` accept null, other fields refuse
   * it. The same permission gates as on creation apply to the fields they
   * protect. Changing the description re-renders the statement; changing the
   * code moves the test data directory (400 `data_directory_taken` if one
   * exists) and changing points, partial scoring or organization privacy
   * rescores the problem. Writes a revision and returns the updated problem.
   * Without `judge.edit_all_problem`, `organizations` and
   * `isOrganizationPrivate` (a move) need the organization problem creation
   * rights in every organization added or removed (403
   * `organization_rights`) and `judge.add_problem` to leave every organization
   * for the site (403 `site_problem_rights`). Any edit that makes a public
   * problem visible to everyone by leaving organization privacy needs
   * `judge.change_public_visibility` (403 `site_publish_rights`); without it,
   * an edit of `isPublic` or `isOrganizationPrivate` saves only while both
   * are as its gates read them (409 `conflict`). A move keeps the code; only a
   * new code of an organization-private problem must carry its first
   * organization's prefix (400 `organization_code_prefix`, superusers
   * exempt). A move into an organization spends its problem credits and must
   * fit its storage (403 `quota_exceeded`).
   */
  @Patch(':code')
  edit(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ProblemCodeParamDto,
    @Body(new RefuseNullFieldsPipe(['licenseId', 'date']))
    body: UpdateProblemDto,
  ): Promise<ProblemDetailResponse> {
    return this.editing.edit(auth, code, body);
  }

  /**
   * Create or replace a statement translation
   *
   * @remarks
   * Needs edit rights on the problem. Stores the name and markdown description
   * for `lang` (`en` or `vi`) and re-renders it. Problems in full-markup mode
   * need `judge.problem_full_markup` to change the text. Sending the stored text
   * again changes nothing. Answers 204 and invalidates the cached PDF
   * statements.
   */
  @Put(':code/translations/:lang')
  @HttpCode(204)
  putTranslation(
    @CurrentAuth() auth: AuthContext,
    @Param() { code, lang }: TranslationParamsDto,
    @Body() body: PutTranslationDto,
  ): Promise<void> {
    return this.statements.putTranslation(auth, code, lang, body);
  }

  /**
   * Create or replace the editorial of a problem
   *
   * @remarks
   * Needs edit rights on the problem. Sets `isPublic`, the `publishOn` time (ISO
   * 8601 with offset), the author ids and the markdown `content`. Readers see
   * the editorial once it is public and `publishOn` has passed. The markdown is
   * always sanitized. Answers 204.
   */
  @Put(':code/editorial')
  @HttpCode(204)
  putEditorial(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ProblemCodeParamDto,
    @Body() body: PutEditorialDto,
  ): Promise<void> {
    return this.statements.putEditorial(auth, code, body);
  }

  /**
   * Clone a problem under a new code
   *
   * @remarks
   * Needs `judge.clone_problem` and edit rights on the source. Copies the
   * statement, limits, languages, classification and visibility settings; test
   * data, translations, editorial, people and counters are not copied. The
   * caller becomes the only curator and the clone starts private. Charges the
   * organization's quota when the source is organization-private (403
   * `quota_exceeded`); a taken code is 400 `code_taken`. Returns the new
   * problem.
   */
  @RequirePermission('judge.clone_problem')
  @Post(':code/clone')
  clone(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ProblemCodeParamDto,
    @Body() body: CloneProblemDto,
  ): Promise<ProblemDetailResponse> {
    return this.clones.clone(auth, code, body);
  }

  /**
   * Render markdown to HTML for the editor preview
   *
   * @remarks
   * Needs `judge.edit_own_problem`. Renders `markdown` with one of the site's
   * render styles and returns the HTML; nothing is saved. The unsanitized
   * `problem-full` style also needs `judge.problem_full_markup`. Limited to 60
   * previews per minute per user (429 `rate_limited`).
   */
  @RequirePermission('judge.edit_own_problem')
  @Post('render-preview')
  @HttpCode(200)
  preview(
    @CurrentAuth() auth: AuthContext,
    @Body() body: RenderPreviewDto,
  ): Promise<RenderPreviewResponse> {
    return this.statements.preview(auth, body);
  }
}
