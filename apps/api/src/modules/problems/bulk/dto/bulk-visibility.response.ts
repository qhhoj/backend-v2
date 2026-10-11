import { ApiProperty } from '@nestjs/swagger';

export const BULK_VISIBILITY_OUTCOMES = [
  'done',
  'unchanged',
  'failed',
] as const;
export type BulkVisibilityOutcome = (typeof BULK_VISIBILITY_OUTCOMES)[number];

export class BulkVisibilityResultResponse {
  /** The problem code from the request. */
  code!: string;
  /** `done` when the problem changed, `unchanged` when it already had that visibility (and date), `failed` when the edit was refused. */
  @ApiProperty({
    enum: BULK_VISIBILITY_OUTCOMES,
    enumName: 'BulkVisibilityOutcome',
  })
  outcome!: BulkVisibilityOutcome;
  /** Set when failed: the error code the single-problem PATCH would answer (`not_found`, `forbidden`, ...). */
  reason?: string;
}

export class BulkVisibilityResponse {
  /** One entry per requested code, in request order. */
  results!: BulkVisibilityResultResponse[];
  /** Number of problems changed. */
  done!: number;
  /** Number of problems refused. */
  failed!: number;
}
