import { ApiProperty } from '@nestjs/swagger';
import { BULK_VISIBILITY_OUTCOMES } from '../../../problems/bulk/dto/bulk-visibility.response';
import type { BulkVisibilityOutcome } from '../../../problems/bulk/dto/bulk-visibility.response';
import { standingOf } from '@libs/contests';
import type { ProblemCell } from '@libs/contests';
import type { Contest, ContestParticipation } from '@libs/database';
import { ApiProblemCells } from '../../core/dto/api-problem-cells';
import { UserSummaryResponse } from '../../../problems/core/dto/user-summary.response';
import { ParticipationSummaryResponse } from '../../core/dto/contest-detail.response';

export class ParticipationResponse extends ParticipationSummaryResponse {
  /** The participant. */
  user!: UserSummaryResponse;
  /** Total score; frozen values for non-editors during a freeze. */
  score!: number;
  /** Cumulative time (penalty) in seconds. */
  cumtime!: number;
  /** Tiebreak value used when scores and times are equal. */
  tiebreaker!: number;
  /** The format's per-problem cells, keyed by problem id. */
  @ApiProblemCells()
  cells!: Record<string, ProblemCell>;

  /** `isFrozenView`: the frozen fields only (`standingOf`). */
  static withUser(
    participation: ContestParticipation,
    contest: Contest,
    user: UserSummaryResponse,
    isFrozenView: boolean,
  ): ParticipationResponse {
    const standing = standingOf(participation, isFrozenView);
    return {
      ...ParticipationSummaryResponse.from(participation, contest),
      user,
      score: standing.score,
      cumtime: standing.cumtime,
      tiebreaker: standing.tiebreaker,
      cells: standing.cells,
    };
  }
}

export class CurrentContestResponse {
  /** Key of the contest. */
  key!: string;
  /** Name of the contest. */
  name!: string;
  /** When the contest starts, ISO 8601. */
  startTime!: Date;
  /** When the contest ends, ISO 8601. */
  endTime!: Date;
}

export class CurrentParticipationResponse {
  contest!: CurrentContestResponse;
  participation!: ParticipationSummaryResponse;
}

export class BulkDisqualifyResultResponse {
  /** The participation id from the request. */
  id!: string;
  /** `done` when the flag changed, `unchanged` when it already had that value, `failed` when the participation is not in the contest. */
  @ApiProperty({
    enum: BULK_VISIBILITY_OUTCOMES,
    enumName: 'BulkVisibilityOutcome',
  })
  outcome!: BulkVisibilityOutcome;
  /** Set when failed: the error code (`not_found`). */
  reason?: string;
}

export class BulkDisqualifyResponse {
  /** One entry per requested id, in request order. */
  results!: BulkDisqualifyResultResponse[];
  /** Number of participations changed. */
  done!: number;
  /** Number of ids refused. */
  failed!: number;
}
