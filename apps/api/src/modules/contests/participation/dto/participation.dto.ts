import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { toBoolean } from '../../../problems/core/dto/transforms';

export const PARTICIPATION_KINDS = ['live', 'virtual', 'spectate'] as const;
export type ParticipationKind = (typeof PARTICIPATION_KINDS)[number];
export const PARTICIPATION_SORTS = ['score'] as const;
export type ParticipationSort = (typeof PARTICIPATION_SORTS)[number];

export class AccessCodeDto {
  @IsOptional() @IsString() @MaxLength(255) accessCode?: string;
}

/** Body of register and join: the access code and the rules acceptance a new participation needs. */
export class JoinBodyDto extends AccessCodeDto {
  @IsOptional() @IsBoolean() acceptRules?: boolean;
  /** The `rulesRevision` the contestant read; a missing or different current revision answers 409 `rules_changed`. Required when the contest has rules. */
  @IsOptional() @IsInt() @Min(0) acceptRulesRevision?: number;
}

export class ParticipationListQueryDto {
  /** 1-based page number. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page: number = 1;
  /** Participations per page, 1 to 100. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 50;
  /** Username; others than the viewer need edit rights. */
  @IsOptional() @IsString() @MaxLength(30) user?: string;
  /** Usernames containing this text, case-insensitive; contest editors only. */
  @IsOptional() @IsString() @MaxLength(30) search?: string;
  /** Only live, virtual or spectating rows; default live and virtual. */
  @ApiPropertyOptional({ enum: PARTICIPATION_KINDS })
  @IsOptional()
  @IsIn(PARTICIPATION_KINDS)
  kind?: ParticipationKind;
  /** Only disqualified (true) or only valid (false) rows. */
  @IsOptional() @Transform(toBoolean) @IsBoolean() disqualified?: boolean;
  /** `score`: best first (score, then time, then tiebreaker); default: live before virtual, oldest first. */
  @ApiPropertyOptional({ enum: PARTICIPATION_SORTS })
  @IsOptional()
  @IsIn(PARTICIPATION_SORTS)
  sort?: ParticipationSort;
}

export class DisqualifyDto {
  /** True to disqualify the participation, false to reinstate it. */
  @IsBoolean() disqualified!: boolean;
}

export const MAX_BULK_PARTICIPATIONS = 100;

export class BulkDisqualifyDto extends DisqualifyDto {
  /** Participation ids, 1 to 100, no repeats. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BULK_PARTICIPATIONS)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(36, { each: true })
  ids!: string[];
}

/** Unvalidated shape: a malformed id is a 404. */
export class ParticipationParamsDto {
  /** Key of the contest. */
  @IsString() key!: string;
  /** Id of the participation. */
  @IsString() id!: string;
}
