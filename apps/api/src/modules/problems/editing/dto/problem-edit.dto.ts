import { LowercaseUuid } from '@libs/common';
import { PartialType } from '@nestjs/swagger';
import {
  PROBLEM_LIMITS,
  SUBMISSION_SOURCE_VISIBILITIES,
  TESTCASE_RESULT_VISIBILITIES,
  TESTCASE_VISIBILITIES,
} from '@libs/database';
import { Type } from 'class-transformer';
import {
  ApiSubmissionSourceVisibility,
  ApiTestcaseResultVisibility,
  ApiTestcaseVisibility,
} from '../../core/dto/problem-visibility';
import {
  ArrayMinSize,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_MARKDOWN_LENGTH } from '../../core/dto/limits';
import { IsProblemCode } from '../../core/dto/problem-code.decorator';
import { IsStatementText } from '../../core/dto/statement-text';
import { IsTimestamp } from '../../core/dto/timestamp';

export class LanguageLimitDto {
  /** Language id. */
  @LowercaseUuid() @IsUUID('7') languageId!: string;
  /** Time limit in seconds for this language. */
  @IsNumber()
  @Min(PROBLEM_LIMITS.timeLimit.min)
  @Max(PROBLEM_LIMITS.timeLimit.max)
  timeLimit!: number;
  /** Memory limit in KiB for this language. */
  @IsInt()
  @Min(PROBLEM_LIMITS.memoryLimit.min)
  @Max(PROBLEM_LIMITS.memoryLimit.max)
  memoryLimit!: number;
}

/**
 * No property initializers: `PartialType` would inherit them and every PATCH would reset the field.
 * Defaults come from the schema, or from `ProblemEditingService.create`.
 */
export class CreateProblemDto {
  /** Unique code: lowercase letters, digits and underscores, 1 to 32 characters; a few words used by routes are reserved. */
  @IsProblemCode()
  code!: string;
  /** Base-language title, 1 to 100 characters. */
  @IsStatementText() @Length(1, 100) name!: string;
  /** Origin or credit line, up to 200 characters. */
  @IsOptional() @IsString() @MaxLength(200) source?: string;
  /** Short summary for previews, up to 1000 characters. Needs `judge.edit_all_problem`. */
  @IsOptional() @IsString() @MaxLength(1000) summary?: string;
  /** Statement in markdown. Rendered with the problem style, or as raw HTML when `isFullMarkup` is set. */
  @IsOptional()
  @IsStatementText()
  @MaxLength(MAX_MARKDOWN_LENGTH)
  description?: string;
  /** Time limit in seconds, 0.01 to 60; above 5 needs `judge.high_problem_timelimit`. */
  @IsNumber()
  @Min(PROBLEM_LIMITS.timeLimit.min)
  @Max(PROBLEM_LIMITS.timeLimit.max)
  timeLimit!: number;
  /** Memory limit in KiB, up to 1048576. */
  @IsInt()
  @Min(PROBLEM_LIMITS.memoryLimit.min)
  @Max(PROBLEM_LIMITS.memoryLimit.max)
  memoryLimit!: number;
  /** Points the problem is worth, 800 to 3500. */
  @IsInt()
  @Min(PROBLEM_LIMITS.points.min)
  @Max(PROBLEM_LIMITS.points.max)
  points!: number;
  /** Whether partial scores are given. */
  @IsOptional() @IsBoolean() partial?: boolean;
  /** Problem type ids, at least one (ids from `GET /problems/meta`). */
  @ArrayMinSize(1)
  @LowercaseUuid()
  @IsUUID('7', { each: true })
  typeIds!: string[];
  /** Problem group id. */
  @LowercaseUuid() @IsUUID('7') groupId!: string;
  /** License id; null for none. Needs `judge.edit_all_problem`. */
  @IsOptional() @LowercaseUuid() @IsUUID('7') licenseId?: string | null;
  /** Who may read submitted sources: `F` follow the site setting, `A` everyone who sees the problem, `S` users who solved it, `O` only the owner, testers and editors. */
  @ApiSubmissionSourceVisibility(false)
  @IsOptional()
  @IsIn(SUBMISSION_SOURCE_VISIBILITIES)
  submissionSourceVisibility?: string;
  /** When program output of test cases is shown to non-editors: `O` never, `C` outside contests, `A` always. */
  @ApiTestcaseVisibility(false)
  @IsOptional()
  @IsIn(TESTCASE_VISIBILITIES)
  testcaseVisibility?: string;
  /** How much of the test case results is shown: `A` every case, `B` batch summaries, `S` totals only. Needs `judge.edit_all_problem`. */
  @ApiTestcaseResultVisibility(false)
  @IsOptional()
  @IsIn(TESTCASE_RESULT_VISIBILITIES)
  testcaseResultVisibility?: string;
  /** Whether checker feedback is shown to submitters. Needs `judge.edit_all_problem`. */
  @IsOptional() @IsBoolean() allowViewFeedback?: boolean;
  /** Users who can see the problem while it is private. */
  @IsOptional()
  @LowercaseUuid()
  @IsUUID('7', { each: true })
  testers?: string[];
  /** Per-language limits overriding the defaults; each language at most once. */
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => LanguageLimitDto)
  languageLimits?: LanguageLimitDto[];
  /** Whether the problem is public. Changing it needs `judge.change_public_visibility`. */
  @IsOptional() @IsBoolean() isPublic?: boolean;
  /** Whether test data is managed outside the site, turning the data editor off. Changing it needs `judge.change_manually_managed`. */
  @IsOptional() @IsBoolean() isManuallyManaged?: boolean;
  /** Whether the statement may contain unsanitized HTML. Changing it needs `judge.problem_full_markup`. */
  @IsOptional() @IsBoolean() isFullMarkup?: boolean;
  /** Author user ids. This field and the ones below up to `date` need `judge.edit_all_problem` (the organization fields only on create, see `organizations`). */
  @IsOptional()
  @LowercaseUuid()
  @IsUUID('7', { each: true })
  authors?: string[];
  /** Curator user ids; curators can edit the problem. */
  @IsOptional()
  @LowercaseUuid()
  @IsUUID('7', { each: true })
  curators?: string[];
  /** User ids that may not submit to the problem. */
  @IsOptional()
  @LowercaseUuid()
  @IsUUID('7', { each: true })
  bannedUsers?: string[];
  /** Ids of languages solutions may use; defaults to the languages flagged for new problems. */
  @IsOptional()
  @LowercaseUuid()
  @IsUUID('7', { each: true })
  allowedLanguages?: string[];
  /** Ids of the organizations the problem is private to (with `isOrganizationPrivate`). On create it needs `judge.edit_all_problem`; on update the organization rules of `PATCH /problems/{code}` apply instead. */
  @IsOptional()
  @LowercaseUuid()
  @IsUUID('7', { each: true })
  organizations?: string[];
  /** Whether only members of `organizations` can see the problem. Gated like `organizations`. */
  @IsOptional() @IsBoolean() isOrganizationPrivate?: boolean;
  /** Image URL used for link previews, up to 150 characters. */
  @IsOptional() @IsString() @MaxLength(150) ogImage?: string;
  /** Publication date (ISO 8601 with offset); null clears it. */
  @IsOptional() @IsTimestamp() date?: string | null;
}

export const MAX_CHANGE_MESSAGE_LENGTH = 500;

export class UpdateProblemDto extends PartialType(CreateProblemDto) {
  /** Why the change was made, kept as the comment of the revision this edit writes; never stored on the problem. Up to 500 characters. */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_CHANGE_MESSAGE_LENGTH)
  changeMessage?: string;
}
