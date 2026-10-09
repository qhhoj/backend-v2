import { PROBLEM_CODE_PATTERN, SUBMISSION_RESULTS } from '@libs/database';
import type { SubmissionResult } from '@libs/database';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsUUID,
  Matches,
} from 'class-validator';

/** Legacy problem "rejudge submissions" form (`rejudge_problem_filter`). */
export class BulkRejudgeDto {
  /** Problem code; required. */
  @Matches(PROBLEM_CODE_PATTERN) problem!: string;
  /** Inclusive id range (UUIDv7 ids sort by submission time). */
  @IsOptional() @IsUUID('7') idFrom?: string;
  @IsOptional() @IsUUID('7') idTo?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('7', { each: true })
  languages?: string[];
  @ApiPropertyOptional({
    enum: SUBMISSION_RESULTS,
    enumName: 'SubmissionResult',
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(SUBMISSION_RESULTS.length)
  @IsIn(SUBMISSION_RESULTS, { each: true })
  results?: SubmissionResult[];
  /** Also rejudge locked submissions. */
  @IsOptional() @IsBoolean() force?: boolean;
  /** Count what would be rejudged and change nothing. */
  @IsOptional() @IsBoolean() dryRun?: boolean;
}

export class BulkRejudgeResponse {
  count!: number;
  dryRun!: boolean;
  /** The caller may run this rejudge: within `BULK_REJUDGE_LIMIT` or holds `judge.rejudge_submission_lot`. */
  allowed!: boolean;
}
