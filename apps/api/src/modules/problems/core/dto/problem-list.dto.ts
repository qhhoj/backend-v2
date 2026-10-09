import { STATEMENT_LANGUAGES } from '@libs/database';
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
import { toArray, toBoolean } from './transforms';

export const PROBLEM_VISIBILITIES = ['public', 'private', 'all'] as const;
export type ProblemVisibility = (typeof PROBLEM_VISIBILITIES)[number];

export class ProblemListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page: number = 1;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 50;
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
  @IsOptional() @IsUUID('7') groupId?: string;
  @IsOptional()
  @Transform(toArray)
  @IsUUID('7', { each: true })
  typeIds?: string[];
  @IsOptional() @Type(() => Number) @IsInt() pointsMin?: number;
  @IsOptional() @Type(() => Number) @IsInt() pointsMax?: number;
  @IsOptional() @Transform(toBoolean) @IsBoolean() hasEditorial?: boolean;
  /** `false`: only problems the viewer has not solved; `true`: only solved ones (an AC with every case point). Anonymous viewers have solved nothing. */
  @IsOptional() @Transform(toBoolean) @IsBoolean() solved?: boolean;
  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(PROBLEM_VISIBILITIES)
  visibility: ProblemVisibility = 'public';
  @ApiPropertyOptional({ enum: PROBLEM_SORT_OPTIONS, enumName: 'ProblemSort' })
  @IsOptional()
  @IsIn(PROBLEM_SORT_OPTIONS)
  sort: string = '-date';
  @ApiPropertyOptional({
    enum: STATEMENT_LANGUAGES,
    enumName: 'StatementLanguage',
  })
  @IsOptional()
  @IsIn(STATEMENT_LANGUAGES)
  lang: StatementLanguage = 'en';
}
