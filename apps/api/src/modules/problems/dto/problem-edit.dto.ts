import { PartialType } from '@nestjs/swagger';
import {
  PROBLEM_CODE_PATTERN,
  PROBLEM_LIMITS,
  SUBMISSION_SOURCE_VISIBILITIES,
  TESTCASE_RESULT_VISIBILITIES,
  TESTCASE_VISIBILITIES,
} from '@libs/database';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsStatementText } from './statement-text';

/** Rendering cost is linear in the Markdown size. */
const MAX_MARKDOWN_LENGTH = 200_000;

export class LanguageLimitDto {
  @IsUUID('7') languageId!: string;
  @IsNumber()
  @Min(PROBLEM_LIMITS.timeLimit.min)
  @Max(PROBLEM_LIMITS.timeLimit.max)
  timeLimit!: number;
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
  @Matches(PROBLEM_CODE_PATTERN, {
    message: 'Only lowercase letters, digits and underscores (1-32).',
  })
  code!: string;
  @IsStatementText() @Length(1, 100) name!: string;
  @IsOptional() @IsString() @MaxLength(200) source?: string;
  @IsOptional() @IsString() @MaxLength(1000) summary?: string;
  @IsOptional()
  @IsStatementText()
  @MaxLength(MAX_MARKDOWN_LENGTH)
  description?: string;
  @IsNumber()
  @Min(PROBLEM_LIMITS.timeLimit.min)
  @Max(PROBLEM_LIMITS.timeLimit.max)
  timeLimit!: number;
  @IsInt()
  @Min(PROBLEM_LIMITS.memoryLimit.min)
  @Max(PROBLEM_LIMITS.memoryLimit.max)
  memoryLimit!: number;
  @IsInt()
  @Min(PROBLEM_LIMITS.points.min)
  @Max(PROBLEM_LIMITS.points.max)
  points!: number;
  @IsOptional() @IsBoolean() partial?: boolean;
  @ArrayMinSize(1) @IsUUID('7', { each: true }) typeIds!: string[];
  @IsUUID('7') groupId!: string;
  @IsOptional() @IsUUID('7') licenseId?: string | null;
  @IsOptional()
  @IsIn(SUBMISSION_SOURCE_VISIBILITIES)
  submissionSourceVisibility?: string;
  @IsOptional() @IsIn(TESTCASE_VISIBILITIES) testcaseVisibility?: string;
  @IsOptional()
  @IsIn(TESTCASE_RESULT_VISIBILITIES)
  testcaseResultVisibility?: string;
  @IsOptional() @IsBoolean() allowViewFeedback?: boolean;
  @IsOptional() @IsUUID('7', { each: true }) testers?: string[];
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => LanguageLimitDto)
  languageLimits?: LanguageLimitDto[];
  /** judge.change_public_visibility */
  @IsOptional() @IsBoolean() isPublic?: boolean;
  /** judge.change_manually_managed */
  @IsOptional() @IsBoolean() isManuallyManaged?: boolean;
  /** judge.problem_full_markup */
  @IsOptional() @IsBoolean() isFullMarkup?: boolean;
  /** The rest need judge.edit_all_problem (Django-admin-only in legacy). */
  @IsOptional() @IsUUID('7', { each: true }) authors?: string[];
  @IsOptional() @IsUUID('7', { each: true }) curators?: string[];
  @IsOptional() @IsUUID('7', { each: true }) bannedUsers?: string[];
  @IsOptional() @IsUUID('7', { each: true }) allowedLanguages?: string[];
  @IsOptional() @IsUUID('7', { each: true }) organizations?: string[];
  @IsOptional() @IsBoolean() isOrganizationPrivate?: boolean;
  @IsOptional() @IsString() @MaxLength(150) ogImage?: string;
  @IsOptional() @IsDateString({ strict: true }) date?: string;
}

export class UpdateProblemDto extends PartialType(CreateProblemDto) {}
