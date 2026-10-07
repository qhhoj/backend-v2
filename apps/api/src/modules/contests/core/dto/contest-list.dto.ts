import type { ContestPhase } from '@libs/contests';
import { CONTEST_TAG_PATTERN } from '@libs/database';
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
import { toBoolean } from '../../../problems/core/dto/transforms';

export const CONTEST_PHASES: readonly ContestPhase[] = [
  'upcoming',
  'running',
  'ended',
];

export class ContestListQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 50;
  @IsOptional() @IsIn(CONTEST_PHASES) phase?: ContestPhase;
  @IsOptional() @Matches(CONTEST_TAG_PATTERN) tag?: string;
  @IsOptional() @IsUUID('7') organization?: string;
  @IsOptional() @Transform(toBoolean) @IsBoolean() rated?: boolean;
  /** Key or name, case-insensitive. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[^\0]*$/)
  search?: string;
}
