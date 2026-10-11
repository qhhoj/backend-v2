import { ApiProperty } from '@nestjs/swagger';
import { BULK_VISIBILITY_OUTCOMES } from '../../../problems/bulk/dto/bulk-visibility.response';
import type { BulkVisibilityOutcome } from '../../../problems/bulk/dto/bulk-visibility.response';

export class BulkContestResultResponse {
  /** The contest key from the request. */
  key!: string;
  /** `done` when the contest changed, `unchanged` when it already was so, `failed` when the edit was refused. */
  // One shared enum component for every bulk route (the OpenAPI quality spec).
  @ApiProperty({
    enum: BULK_VISIBILITY_OUTCOMES,
    enumName: 'BulkVisibilityOutcome',
  })
  outcome!: BulkVisibilityOutcome;
  /** Set when failed: the error code the single-contest PATCH would answer (`not_found`, `forbidden`, `conflict`, ...), or `too_many_tags`. */
  reason?: string;
}

export class BulkContestResponse {
  /** One entry per requested key, in request order. */
  results!: BulkContestResultResponse[];
  /** Number of contests changed. */
  done!: number;
  /** Number of contests refused. */
  failed!: number;
}
