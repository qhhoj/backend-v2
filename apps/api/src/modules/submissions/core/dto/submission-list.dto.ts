import { SUBMISSION_RESULTS, SUBMISSION_STATUSES } from '@libs/database';
import type { SubmissionResult, SubmissionStatus } from '@libs/database';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { toArray } from '@libs/common';

export class SubmissionListQueryDto {
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
  /** Username. */
  @IsOptional() @IsString() @MaxLength(30) user?: string;
  /** Problem code. */
  @IsOptional() @IsString() @MaxLength(32) problem?: string;
  /** Language ids; repeat the parameter. */
  @IsOptional()
  @Transform(toArray)
  @ArrayMaxSize(50)
  @IsUUID('7', { each: true })
  language?: string[];
  /** Only submissions with these verdicts (`AC`, `WA`, `TLE`, ...); repeat the parameter. `IE`, `SC` are staff only. */
  @ApiPropertyOptional({
    enum: SUBMISSION_RESULTS,
    enumName: 'SubmissionResult',
    isArray: true,
  })
  @IsOptional()
  @Transform(toArray)
  @ArrayMaxSize(SUBMISSION_RESULTS.length)
  @IsIn(SUBMISSION_RESULTS, { each: true })
  result?: SubmissionResult[];
  /** Only submissions in these judging states (`QU`, `P`, `G`, `D`, `IE`, `CE`, `AB`, `PD`); repeat the parameter. `IE`, `QU`, `P`, `G`, `D` are staff only. */
  @ApiPropertyOptional({
    enum: SUBMISSION_STATUSES,
    enumName: 'SubmissionStatus',
    isArray: true,
  })
  @IsOptional()
  @Transform(toArray)
  @ArrayMaxSize(SUBMISSION_STATUSES.length)
  @IsIn(SUBMISSION_STATUSES, { each: true })
  status?: SubmissionStatus[];
}
