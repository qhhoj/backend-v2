import { LowercaseUuid } from '@libs/common';
import {
  CONTEST_KEY_PATTERN,
  JUDGE_NAME_PATTERN,
  PROBLEM_CODE_PATTERN,
  SUBMISSION_RESULTS,
} from '@libs/database';
import type { SubmissionResult } from '@libs/database';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { IsTimestamp } from '../../../problems/core/dto/timestamp';
import { SubmissionListItemResponse } from '../../core/dto/submission-list.response';

export const BATCH_ACTIONS = ['rejudge', 'rescore'] as const;
export type BatchAction = (typeof BATCH_ACTIONS)[number];

/** Most ids one request may name: a page of the admin list, selected. */
export const MAX_BATCH_IDS = 1000;

/** Legacy `apply_submission_filter` over any changelist filter. The scope (`contest`, else `problem`, else the whole site) decides which edit right is needed. */
export class SubmissionBatchFilterDto {
  /** Problem code. */
  @IsOptional() @Matches(PROBLEM_CODE_PATTERN) problem?: string;
  /** Contest key: only that contest's submissions. */
  @IsOptional() @Matches(CONTEST_KEY_PATTERN) contest?: string;
  /** Username. */
  @IsOptional() @IsString() @MaxLength(30) user?: string;
  /** Only these submissions (a selection from the list). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_BATCH_IDS)
  @LowercaseUuid()
  @IsUUID('7', { each: true })
  ids?: string[];
  /** Lowest submission id (UUIDv7 ids sort by submission time). */
  @IsOptional() @LowercaseUuid() @IsUUID('7') idFrom?: string;
  /** Highest submission id. */
  @IsOptional() @LowercaseUuid() @IsUUID('7') idTo?: string;
  /** Submitted at or after this time. */
  @IsOptional() @IsTimestamp() dateFrom?: string;
  /** Submitted before this time. */
  @IsOptional() @IsTimestamp() dateTo?: string;
  /** Only submissions in these language ids. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @LowercaseUuid()
  @IsUUID('7', { each: true })
  languages?: string[];
  /** Only submissions with these verdicts. */
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
  /** Only submissions last graded by this judge. */
  @IsOptional() @Matches(JUDGE_NAME_PATTERN) judgedOn?: string;
}

/** Legacy problem "rejudge submissions" form and the changelist `judge` action. */
export class BulkRejudgeDto extends SubmissionBatchFilterDto {
  /** Also rejudge locked submissions. */
  @IsOptional() @IsBoolean() force?: boolean;
  /** Count what would be rejudged and change nothing. */
  @IsOptional() @IsBoolean() dryRun?: boolean;
}

/** Legacy changelist `recalculate_score` action. */
export class BulkRescoreDto extends SubmissionBatchFilterDto {
  /** Count what would be rescored and queue nothing. */
  @IsOptional() @IsBoolean() dryRun?: boolean;
}

export class BulkRejudgeResponse {
  /** Submissions matched (dry run) or reset for rejudging. */
  count!: number;
  /** Whether nothing was changed. */
  dryRun!: boolean;
  /** The caller may run this rejudge: within `BULK_REJUDGE_LIMIT` or holds `judge.rejudge_submission_lot`. */
  allowed!: boolean;
  /** The newest few matches, on a dry run only; empty otherwise. */
  sample!: SubmissionListItemResponse[];
}

export class BulkRescoreResponse {
  /** Submissions matched. */
  count!: number;
  /** Problems whose submissions are recomputed (outside a contest scope). */
  problems!: number;
  /** Contests whose results are recomputed. */
  contests!: number;
  /** Whether nothing was queued. */
  dryRun!: boolean;
}

export class SubmissionBatchUserResponse {
  /** User id. */
  id!: string;
  /** Username; null when the user is gone. */
  username!: string | null;
}

export class SubmissionBatchLogResponse {
  /** Log entry id. */
  id!: string;
  /** What was run. */
  @ApiProperty({ enum: BATCH_ACTIONS, enumName: 'SubmissionBatchAction' })
  action!: BatchAction;
  /** Who ran it. */
  user!: SubmissionBatchUserResponse | null;
  /** Submissions it touched. */
  count!: number;
  /** The filter it ran with. */
  filter!: SubmissionBatchFilterDto;
  /** When it ran. */
  createdAt!: Date;
}
