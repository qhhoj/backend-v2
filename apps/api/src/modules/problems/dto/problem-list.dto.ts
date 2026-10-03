import { STATEMENT_LANGUAGES } from '@libs/database';
import type { StatementLanguage } from '@libs/database';
import { Transform, Type } from 'class-transformer';
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
import { toArray, toBoolean } from './transforms';

export const PROBLEM_VISIBILITIES = ['public', 'private', 'all'] as const;
export type ProblemVisibility = (typeof PROBLEM_VISIBILITIES)[number];

export class ProblemListQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 50;
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[^\0]*$/)
  search?: string;
  @IsOptional() @IsUUID('7') groupId?: string;
  @IsOptional()
  @Transform(toArray)
  @IsUUID('7', { each: true })
  typeIds?: string[];
  @IsOptional() @Type(() => Number) @IsInt() pointsMin?: number;
  @IsOptional() @Type(() => Number) @IsInt() pointsMax?: number;
  @IsOptional() @Transform(toBoolean) @IsBoolean() hasEditorial?: boolean;
  @IsOptional() @IsIn(PROBLEM_VISIBILITIES) visibility: ProblemVisibility =
    'public';
  @IsOptional() @IsIn(PROBLEM_SORT_OPTIONS) sort = '-date';
  @IsOptional() @IsIn(STATEMENT_LANGUAGES) lang: StatementLanguage = 'en';
}
