import {
  CONTEST_FORMAT_NAMES,
  CONTEST_KEY_PATTERN,
  MAX_CONTEST_PROBLEMS,
  PROBLEM_CODE_PATTERN,
  PROBLEM_LIMITS,
} from '@libs/database';
import type { ContestFormatName } from '@libs/database';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_MARKDOWN_LENGTH } from '../../../problems/core/dto/limits';
import { IsTimestamp } from '../../../problems/core/dto/timestamp';

export class SyncProblemDto {
  @Matches(PROBLEM_CODE_PATTERN) code!: string;
  @IsInt() @Min(0) @Max(PROBLEM_LIMITS.points.max) points!: number;
  /** Partial scoring; true when omitted. */
  @IsOptional() @IsBoolean() partial?: boolean;
}

/** Everything a sync client may set. There is deliberately no visibility, privacy, organization, author, access-code or rating field: the global pipe refuses unknown fields, so "never public" holds by construction. A `PUT` replaces: an omitted optional field returns to its default. */
export class SyncContestDto {
  @IsString() @Length(1, 100) name!: string;
  @IsOptional()
  @IsString()
  @MaxLength(MAX_MARKDOWN_LENGTH)
  description?: string;
  @IsTimestamp() startTime!: string;
  @IsTimestamp() endTime!: string;
  /** Seconds a participant has once started; omitted, the whole window. */
  @IsOptional() @IsInt() @Min(1) timeLimit?: number;
  @IsOptional() @IsInt() @Min(0) frozenLastMinutes?: number;
  // An alias of a union, so spelled out with the SDK's shared enum name (SDK R3).
  /** The scoring format; `default` when omitted. */
  @ApiPropertyOptional({
    enum: CONTEST_FORMAT_NAMES,
    enumName: 'ContestFormatName',
  })
  @IsOptional()
  @IsIn(CONTEST_FORMAT_NAMES)
  formatName?: ContestFormatName;
  /** Free-form JSON: the keys depend on the format. */
  @IsOptional()
  @IsObject()
  formatConfig?: Record<string, unknown>;
  /** In contest order. */
  @IsArray()
  @ArrayMaxSize(MAX_CONTEST_PROBLEMS)
  @ValidateNested({ each: true })
  @Type(() => SyncProblemDto)
  problems!: SyncProblemDto[];
}

export class SyncContestKeyParamDto {
  @Matches(CONTEST_KEY_PATTERN, {
    message: 'Only lowercase letters, digits and underscores (1-32).',
  })
  key!: string;
}

export class SyncUpsertQueryDto {
  /** `true` validates everything and writes nothing. */
  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  dryRun?: 'true' | 'false';
}
