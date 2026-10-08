import { standingOf } from '@libs/contests';
import type { ProblemCell } from '@libs/contests';
import type { Contest, ContestParticipation } from '@libs/database';
import { ApiProblemCells } from '../../core/dto/api-problem-cells';
import { UserSummaryResponse } from '../../../problems/core/dto/user-summary.response';
import { ParticipationSummaryResponse } from '../../core/dto/contest-detail.response';

export class ParticipationResponse extends ParticipationSummaryResponse {
  user!: UserSummaryResponse;
  score!: number;
  cumtime!: number;
  tiebreaker!: number;
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
  key!: string;
  name!: string;
  startTime!: Date;
  endTime!: Date;
}

export class CurrentParticipationResponse {
  contest!: CurrentContestResponse;
  participation!: ParticipationSummaryResponse;
}
