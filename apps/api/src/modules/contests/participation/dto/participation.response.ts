import { standingOf } from '@libs/contests';
import type { ProblemCell } from '@libs/contests';
import type { Contest, ContestParticipation } from '@libs/database';
import { UserSummaryResponse } from '../../../problems/dto/user-summary.response';
import { ParticipationSummaryResponse } from '../../core/dto/contest-detail.response';

export class ParticipationResponse extends ParticipationSummaryResponse {
  user!: UserSummaryResponse;
  score!: number;
  cumtime!: number;
  tiebreaker!: number;
  cells!: Record<string, ProblemCell>;

  /** `frozen`: the frozen fields only (`standingOf`). */
  static withUser(
    participation: ContestParticipation,
    contest: Contest,
    user: UserSummaryResponse,
    frozen: boolean,
  ): ParticipationResponse {
    const standing = standingOf(participation, frozen);
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

export class CurrentParticipationResponse {
  contest!: { key: string; name: string; startTime: Date; endTime: Date };
  participation!: ParticipationSummaryResponse;
}
