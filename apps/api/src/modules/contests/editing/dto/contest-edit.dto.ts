import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import {
  CONTEST_FORMAT_NAMES,
  CONTEST_KEY_PATTERN,
  CONTEST_RULES_MAX,
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
  /** Id of the problem to include. */
  @IsUUID('7') problem!: string;
  /** Points the problem is worth. */
  @IsInt() @Min(0) @Max(PROBLEM_LIMITS.points.max) points!: number;
  /** Whether partial scores are given. */
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  partial?: boolean;
  /** Whether the problem is judged on pretests during the contest. */
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  isPretested?: boolean;
  /** Bytes of output to show; null uses the judge default. */
  @IsOptional() @IsInt() @Min(0) outputPrefixOverride?: number | null;
  /** Most scored submissions per participant; null for unlimited. */
  @IsOptional() @IsInt() @Min(1) maxSubmissions?: number | null;
}

/** Empty, an http(s) URL or a site path (the blog's rule, minus protocol-relative `//host`); never `javascript:` or `data:`. */
const IMAGE_URL_PATTERN = /^(|https?:\/\/[^\s"'<>]+|\/(?!\/)[^\s"'<>]*)$/;

/** Tags one contest may carry. */
export const MAX_TAGS_PER_CONTEST = 20;

/** No property initializers (see `CreateProblemDto`); defaults come from the schema. `problems` order is the contest order. */
export class CreateContestDto {
  /**
   * Unique identifier used in URLs: lowercase letters, digits and underscores,
   * 1 to 32.
   */
  @Matches(CONTEST_KEY_PATTERN, {
    message: 'Only lowercase letters, digits and underscores (1-32).',
  })
  key!: string;
  /** Contest name, 1 to 100 characters. */
  @IsString() @Length(1, 100) name!: string;
  /** Markdown description. */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_MARKDOWN_LENGTH)
  description?: string;
  /** Short plain-text description for lists, at most 1000 characters. */
  @IsOptional() @IsString() @MaxLength(1000) summary?: string;
  /** Image for link previews: an http(s) URL or a site path, up to 150 characters; empty for the site image. */
  @IsOptional()
  @MaxLength(150)
  @Matches(IMAGE_URL_PATTERN, {
    message: 'An http(s) URL or a path starting with /.',
  })
  ogImage?: string;
  /** Replaces the site logo inside the contest: an http(s) URL or a site path, up to 150 characters; empty for none. */
  @IsOptional()
  @MaxLength(150)
  @Matches(IMAGE_URL_PATTERN, {
    message: 'An http(s) URL or a path starting with /.',
  })
  logoOverrideImage?: string;
  /** Markdown, trimmed at save; empty or whitespace: no rules. */
  @IsOptional() @IsString() @MaxLength(CONTEST_RULES_MAX) rules?: string;
  /** Contest tag slugs, at most 20; unknown tags are refused. */
  @IsOptional()
  @ArrayMaxSize(MAX_TAGS_PER_CONTEST)
  @Matches(CONTEST_TAG_PATTERN, { each: true })
  tags?: string[];
  /** User ids of the authors. */
  @IsOptional() @IsUUID('7', { each: true }) authors?: string[];
  /** User ids with edit rights besides the authors. */
  @IsOptional() @IsUUID('7', { each: true }) curators?: string[];
  /** User ids who can see the contest and spectate it before it starts. */
  @IsOptional() @IsUUID('7', { each: true }) testers?: string[];
  /** Start, ISO 8601. */
  @IsTimestamp() startTime!: string;
  /** End, ISO 8601. */
  @IsTimestamp() endTime!: string;
  /** Seconds. */
  @IsOptional() @IsInt() @Min(1) timeLimit?: number | null;
  /**
   * When registration opens, ISO 8601; null with registrationEnd null for no
   * registration.
   */
  @IsOptional() @IsTimestamp() registrationStart?: string | null;
  /** When registration closes, ISO 8601. */
  @IsOptional() @IsTimestamp() registrationEnd?: string | null;
  /**
   * Minutes before the end during which the ranking is frozen for non-editors;
   * 0 for none.
   */
  @IsOptional() @IsInt() @Min(0) frozenLastMinutes?: number;
  /**
   * Live submissions are not rejudged after this time, ISO 8601; null for
   * none.
   */
  @IsOptional() @IsTimestamp() lockedAfter?: string | null;
  /** Forbid virtual participation after the end. */
  @IsOptional() @IsBoolean() disallowVirtual?: boolean;
  /** Whether the contest is shown to users who may see it. */
  @IsOptional() @IsBoolean() isVisible?: boolean;
  /** Only the listed contestants may see it. Clearing it on a visible contest that becomes public needs `judge.change_contest_visibility`. */
  @IsOptional() @IsBoolean() isPrivate?: boolean;
  /** User ids allowed in a private contest. */
  @IsOptional() @IsUUID('7', { each: true }) privateContestants?: string[];
  /** Only members of the listed organizations may see it. Clearing it on a visible contest that becomes public needs `judge.change_contest_visibility`. */
  @IsOptional() @IsBoolean() isOrganizationPrivate?: boolean;
  /** Organization ids tied to the contest. */
  @IsOptional() @IsUUID('7', { each: true }) organizations?: string[];
  /** Stored hashed; an empty string removes it. */
  @IsOptional() @IsString() @MaxLength(255) accessCode?: string;
  /** Stored hashed; an empty string removes it. */
  @IsOptional() @IsString() @MaxLength(255) rankingAccessCode?: string;
  /** User ids banned from joining. */
  @IsOptional() @IsUUID('7', { each: true }) bannedUsers?: string[];
  /** Names of judges that may not judge this contest. */
  @IsOptional()
  @Matches(JUDGE_NAME_PATTERN, { each: true })
  bannedJudges?: string[];
  /** Who sees the scoreboard and when. */
  @ApiPropertyOptional({
    enum: SCOREBOARD_VISIBILITIES,
    enumName: 'ScoreboardVisibility',
  })
  @IsOptional()
  @IsIn(SCOREBOARD_VISIBILITIES)
  scoreboardVisibility?: ScoreboardVisibility;
  /** User ids who may see the scoreboard whatever its visibility. */
  @IsOptional() @IsUUID('7', { each: true }) viewContestScoreboard?: string[];
  /** Seconds; 0 disables the ranking cache. */
  @IsOptional() @IsInt() @Min(0) @Max(86400) scoreboardCacheTimeout?: number;
  /**
   * Whether contestants see everyone's submissions while the contest runs.
   */
  @IsOptional() @IsBoolean() showSubmissionList?: boolean;
  /** Decimal places shown in scores. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_POINTS_PRECISION)
  pointsPrecision?: number;
  /** Judge on pretests only until the contest ends. */
  @IsOptional() @IsBoolean() runPretestsOnly?: boolean;
  /** Hide problem tags from contestants. */
  @IsOptional() @IsBoolean() hideProblemTags?: boolean;
  /** Hide problem authors from contestants. */
  @IsOptional() @IsBoolean() hideProblemAuthors?: boolean;
  /** Show problem points and counts in a compact form. */
  @IsOptional() @IsBoolean() showShortDisplay?: boolean;
  /** Push announcements live and to notification inboxes. */
  @IsOptional() @IsBoolean() pushAnnouncements?: boolean;
  /** Track on-site balloon deliveries. */
  @IsOptional() @IsBoolean() balloons?: boolean;
  /** User ids of balloon volunteers. */
  @IsOptional() @IsUUID('7', { each: true }) balloonStaff?: string[];
  /**
   * Publish the problems and editorials automatically when the contest ends.
   */
  @IsOptional() @IsBoolean() publishAfterEnd?: boolean;
  /** How problems are labelled in the contest. */
  @ApiPropertyOptional({ enum: LABEL_STYLES, enumName: 'ContestLabelStyle' })
  @IsOptional()
  @IsIn(LABEL_STYLES)
  labelStyle?: LabelStyle;
  /** Whether the contest changes ratings. */
  @IsOptional() @IsBoolean() isRated?: boolean;
  /** Rate every participant, not only those who solved a problem. */
  @IsOptional() @IsBoolean() rateAll?: boolean;
  /** User ids excluded from rating. */
  @IsOptional() @IsUUID('7', { each: true }) rateExclude?: string[];
  /** Rating floor applied when rating the contest; null for none. */
  @IsOptional() @IsInt() ratingFloor?: number | null;
  /** Rating ceiling applied when rating the contest; null for none. */
  @IsOptional() @IsInt() ratingCeiling?: number | null;
  /** Scoring format of the contest. */
  @ApiPropertyOptional({
    enum: CONTEST_FORMAT_NAMES,
    enumName: 'ContestFormatName',
  })
  @IsOptional()
  @IsIn(CONTEST_FORMAT_NAMES)
  formatName?: ContestFormatName;
  /** Checked by the format (`parseFormatConfig`); omitted on a format change: that format's defaults. */
  @IsOptional() @IsObject() formatConfig?: Record<string, unknown>;
  /** The contest's problems; the array order is the contest order. */
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
