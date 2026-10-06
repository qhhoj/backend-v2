import { SUBMISSION_RESULTS, SUBMISSION_STATUSES } from '@libs/database';
import type { SubmissionResult, SubmissionStatus } from '@libs/database';
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
import { toArray } from '../../problems/dto/transforms';

export class SubmissionListQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 50;
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
  @IsOptional()
  @Transform(toArray)
  @ArrayMaxSize(SUBMISSION_RESULTS.length)
  @IsIn(SUBMISSION_RESULTS, { each: true })
  result?: SubmissionResult[];
  @IsOptional()
  @Transform(toArray)
  @ArrayMaxSize(SUBMISSION_STATUSES.length)
  @IsIn(SUBMISSION_STATUSES, { each: true })
  status?: SubmissionStatus[];
}
