import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  Matches,
} from 'class-validator';
import { PROBLEM_GLOB_PATTERN } from '@libs/contests';
import { SUBMISSION_RESULTS } from '@libs/database';
import type { SubmissionResult } from '@libs/database';

export class PrepareDataDto {
  /** Legacy `submission_problem_glob`; default `*`. */
  @IsOptional() @Matches(PROBLEM_GLOB_PATTERN) problemGlob?: string;
  /** Legacy `submission_results`; empty or absent: every result. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(SUBMISSION_RESULTS.length)
  @IsIn(SUBMISSION_RESULTS, { each: true })
  results?: SubmissionResult[];
}

export class ContestDataStatusResponse {
  state!: 'none' | 'preparing' | 'ready';
  /** When the last prepare was requested. */
  preparedAt!: string | null;
  /** When the zip on disk was written. */
  readyAt!: string | null;
  size!: number | null;
  /** Null when a prepare is allowed now. */
  nextPrepareAt!: string | null;
}
