import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import {
  CONTEST_FORMAT_NAMES,
  CONTEST_KEY_PATTERN,
  CONTEST_TAG_PATTERN,
  JUDGE_NAME_PATTERN,
  LABEL_STYLES,
  MAX_CONTEST_PROBLEMS,
  MAX_POINTS_PRECISION,
  PROBLEM_LIMITS,
  SCOREBOARD_VISIBILITIES,
} from '@libs/database';
import type {
  ContestFormatName,
  LabelStyle,
  ScoreboardVisibility,
} from '@libs/database';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { MAX_MARKDOWN_LENGTH } from '../../../problems/core/dto/limits';
import { IsTimestamp } from '../../../problems/core/dto/timestamp';

export class ContestProblemDto {
  @IsUUID('7') problem!: string;
  @IsInt() @Min(0) @Max(PROBLEM_LIMITS.points.max) points!: number;
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  partial?: boolean;
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  isPretested?: boolean;
  @IsOptional() @IsInt() @Min(0) outputPrefixOverride?: number | null;
  @IsOptional() @IsInt() @Min(1) maxSubmissions?: number | null;
}

/** No property initializers (see `CreateProblemDto`); defaults come from the schema. `problems` order is the contest order. */
export class CreateContestDto {
  @Matches(CONTEST_KEY_PATTERN, {
    message: 'Only lowercase letters, digits and underscores (1-32).',
  })
  key!: string;
  @IsString() @Length(1, 100) name!: string;
  @IsOptional()
  @IsString()
  @MaxLength(MAX_MARKDOWN_LENGTH)
  description?: string;
  @IsOptional() @IsString() @MaxLength(1000) summary?: string;
  @IsOptional()
  @ArrayMaxSize(20)
  @Matches(CONTEST_TAG_PATTERN, { each: true })
  tags?: string[];
  @IsOptional() @IsUUID('7', { each: true }) authors?: string[];
  @IsOptional() @IsUUID('7', { each: true }) curators?: string[];
  @IsOptional() @IsUUID('7', { each: true }) testers?: string[];
  @IsTimestamp() startTime!: string;
  @IsTimestamp() endTime!: string;
  /** Seconds. */
  @IsOptional() @IsInt() @Min(1) timeLimit?: number | null;
  @IsOptional() @IsTimestamp() registrationStart?: string | null;
  @IsOptional() @IsTimestamp() registrationEnd?: string | null;
  @IsOptional() @IsInt() @Min(0) frozenLastMinutes?: number;
  @IsOptional() @IsTimestamp() lockedAfter?: string | null;
  @IsOptional() @IsBoolean() disallowVirtual?: boolean;
  @IsOptional() @IsBoolean() isVisible?: boolean;
  @IsOptional() @IsBoolean() isPrivate?: boolean;
  @IsOptional() @IsUUID('7', { each: true }) privateContestants?: string[];
  @IsOptional() @IsBoolean() isOrganizationPrivate?: boolean;
  @IsOptional() @IsUUID('7', { each: true }) organizations?: string[];
  /** Stored hashed; an empty string removes it. */
  @IsOptional() @IsString() @MaxLength(255) accessCode?: string;
  /** Stored hashed; an empty string removes it. */
  @IsOptional() @IsString() @MaxLength(255) rankingAccessCode?: string;
  @IsOptional() @IsUUID('7', { each: true }) bannedUsers?: string[];
  @IsOptional()
  @Matches(JUDGE_NAME_PATTERN, { each: true })
  bannedJudges?: string[];
  @ApiPropertyOptional({
    enum: SCOREBOARD_VISIBILITIES,
    enumName: 'ScoreboardVisibility',
  })
  @IsOptional()
  @IsIn(SCOREBOARD_VISIBILITIES)
  scoreboardVisibility?: ScoreboardVisibility;
  @IsOptional() @IsUUID('7', { each: true }) viewContestScoreboard?: string[];
  /** Seconds; 0 disables the ranking cache. */
  @IsOptional() @IsInt() @Min(0) @Max(86400) scoreboardCacheTimeout?: number;
  @IsOptional() @IsBoolean() showSubmissionList?: boolean;
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_POINTS_PRECISION)
  pointsPrecision?: number;
  @IsOptional() @IsBoolean() runPretestsOnly?: boolean;
  @IsOptional() @IsBoolean() hideProblemTags?: boolean;
  @IsOptional() @IsBoolean() hideProblemAuthors?: boolean;
  @IsOptional() @IsBoolean() showShortDisplay?: boolean;
  @IsOptional() @IsBoolean() pushAnnouncements?: boolean;
  @ApiPropertyOptional({ enum: LABEL_STYLES, enumName: 'ContestLabelStyle' })
  @IsOptional()
  @IsIn(LABEL_STYLES)
  labelStyle?: LabelStyle;
  @IsOptional() @IsBoolean() isRated?: boolean;
  @IsOptional() @IsBoolean() rateAll?: boolean;
  @IsOptional() @IsUUID('7', { each: true }) rateExclude?: string[];
  @IsOptional() @IsInt() ratingFloor?: number | null;
  @IsOptional() @IsInt() ratingCeiling?: number | null;
  @ApiPropertyOptional({
    enum: CONTEST_FORMAT_NAMES,
    enumName: 'ContestFormatName',
  })
  @IsOptional()
  @IsIn(CONTEST_FORMAT_NAMES)
  formatName?: ContestFormatName;
  /** Checked by the format (`parseFormatConfig`); omitted on a format change: that format's defaults. */
  @IsOptional() @IsObject() formatConfig?: Record<string, unknown>;
  @IsOptional()
  @ArrayMaxSize(MAX_CONTEST_PROBLEMS)
  @ValidateNested({ each: true })
  @Type(() => ContestProblemDto)
  problems?: ContestProblemDto[];
}

export class UpdateContestDto extends PartialType(
  OmitType(CreateContestDto, ['key'] as const),
) {}

/** The `UpdateContestDto` fields typed `| null`; every other one refuses null. */
export const NULLABLE_CONTEST_FIELDS: ReadonlyArray<keyof UpdateContestDto> = [
  'timeLimit',
  'registrationStart',
  'registrationEnd',
  'lockedAfter',
  'ratingFloor',
  'ratingCeiling',
];
