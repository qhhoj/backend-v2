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
import { IsTimestamp } from '../../../problems/core/dto/timestamp';
import { toBoolean } from '../../../problems/core/dto/transforms';

/** `newest` and `oldest` order by start time, `name` A to Z, `users` most participants first. */
export const CONTEST_LIST_SORTS = [
  'newest',
  'oldest',
  'name',
  'users',
] as const;
export type ContestListSort = (typeof CONTEST_LIST_SORTS)[number];

export class ContestListQueryDto {
  /** 1-based page number. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page: number = 1;
  /** Contests per page, 1 to 100. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 50;
  /** Only contests currently upcoming, running or ended. */
  @ApiPropertyOptional({ enum: CONTEST_PHASES, enumName: 'ContestPhase' })
  @IsOptional()
  @IsIn(CONTEST_PHASES)
  phase?: ContestPhase;
  /** Only contests carrying this tag slug. */
  @IsOptional() @Matches(CONTEST_TAG_PATTERN) tag?: string;
  /** Only contests of this organization id. */
  @IsOptional() @IsUUID('7') organization?: string;
  /** Only rated (true) or unrated (false) contests. */
  @IsOptional() @Transform(toBoolean) @IsBoolean() rated?: boolean;
  /** true: only contests the viewer may edit (the admin screen's index); false: only the others. */
  @IsOptional() @Transform(toBoolean) @IsBoolean() editable?: boolean;
  /** true: only visible contests; false: only hidden ones (which only their editors, testers and staff see). */
  @IsOptional() @Transform(toBoolean) @IsBoolean() visible?: boolean;
  /** true: only contests the viewer authors, curates or tests; a signed-out visitor gets none. */
  @IsOptional() @Transform(toBoolean) @IsBoolean() mine?: boolean;
  /** Only contests starting at or after this time, ISO 8601. */
  @IsOptional() @IsTimestamp() startFrom?: string;
  /** Only contests starting before this time, ISO 8601. */
  @IsOptional() @IsTimestamp() startBefore?: string;
  /** Row order; without it upcoming contests come soonest first and the rest newest first. */
  @ApiPropertyOptional({
    enum: CONTEST_LIST_SORTS,
    enumName: 'ContestListSort',
  })
  @IsOptional()
  @IsIn(CONTEST_LIST_SORTS)
  sort?: ContestListSort;
  /** Key or name substring, case-insensitive; at most 100 characters. ANDed with `search`, which stays. */
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
