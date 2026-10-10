import { BASE_STATEMENT_LANGUAGE, STATEMENT_LANGUAGES } from '@libs/database';
import type { StatementLanguage } from '@libs/database';
import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PROBLEM_SORT_OPTIONS } from '../problem-search';
import { toArray } from '@libs/common';
import { toBoolean } from './transforms';

export const PROBLEM_VISIBILITIES = ['public', 'private', 'all'] as const;
export type ProblemVisibility = (typeof PROBLEM_VISIBILITIES)[number];

/** The filters shared by the list and the random pick. */
export class ProblemFilterQueryDto {
  /** Text search over code, names and source; terms of 3+ characters use the full-text index, shorter ones match prefixes of the code or a title. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[^\0]*$/)
  search?: string;
  /** Case-insensitive substring of the code or any title; at most 100 characters. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[^\0]*$/)
  // eslint-disable-next-line id-length -- the wire name, shared with the users list
  q?: string;
  /** Only problems in this problem group (id from `GET /problems/meta`). */
  @IsOptional() @IsUUID('7') groupId?: string;
  /** Only problems having any of these problem types (ids from `GET /problems/meta`); repeat the parameter. */
  @IsOptional()
  @Transform(toArray)
  @IsUUID('7', { each: true })
  typeIds?: string[];
  /** Only problems worth at least this many points. */
  @IsOptional() @Type(() => Number) @IsInt() pointsMin?: number;
  /** Only problems worth at most this many points. */
  @IsOptional() @Type(() => Number) @IsInt() pointsMax?: number;
  /** true: only problems with a published editorial; false: only problems without one. */
  @IsOptional() @Transform(toBoolean) @IsBoolean() hasEditorial?: boolean;
  /** `false`: only problems the viewer has not solved; `true`: only solved ones (an AC with every case point). Anonymous viewers have solved nothing. */
  @IsOptional() @Transform(toBoolean) @IsBoolean() solved?: boolean;
  /** `public` (default): public problems; `private`: visible problems that are not public; `all`: both. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(PROBLEM_VISIBILITIES)
  visibility: ProblemVisibility = 'public';
  /** Language of the returned titles; falls back to the base language when untranslated. */
  @ApiPropertyOptional({
    enum: STATEMENT_LANGUAGES,
    enumName: 'StatementLanguage',
  })
  @IsOptional()
  @IsIn(STATEMENT_LANGUAGES)
  lang: StatementLanguage = BASE_STATEMENT_LANGUAGE;
}

export class ProblemListQueryDto extends ProblemFilterQueryDto {
  /** Page number, from 1. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page: number = 1;
  /** Items per page, 1 to 100. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 50;
  /** Sort field (`date`, `code`, `name`, `points`, `acRate`, `userCount`); a leading `-` sorts descending. */
  @ApiPropertyOptional({ enum: PROBLEM_SORT_OPTIONS, enumName: 'ProblemSort' })
  @IsOptional()
  @IsIn(PROBLEM_SORT_OPTIONS)
  sort: string = '-date';
}
