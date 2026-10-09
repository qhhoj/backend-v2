import { CONTEST_PHASES } from '@libs/contests';
import type { ContestPhase } from '@libs/contests';
import { CONTEST_TAG_PATTERN } from '@libs/database';
import { ApiPropertyOptional } from '@nestjs/swagger';
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

export class ContestListQueryDto {
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
  @ApiPropertyOptional({ enum: CONTEST_PHASES, enumName: 'ContestPhase' })
  @IsOptional()
  @IsIn(CONTEST_PHASES)
  phase?: ContestPhase;
  @IsOptional() @Matches(CONTEST_TAG_PATTERN) tag?: string;
  @IsOptional() @IsUUID('7') organization?: string;
  @IsOptional() @Transform(toBoolean) @IsBoolean() rated?: boolean;
  /** Key or name substring, case-insensitive; at most 100 characters. Same match as `search`, which stays. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[^\0]*$/)
  // eslint-disable-next-line id-length -- the wire name, shared with the users list
  q?: string;
  /** Key or name, case-insensitive. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[^\0]*$/)
  search?: string;
}
