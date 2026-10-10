import { ApiProblemCells } from '../../core/dto/api-problem-cells';
import type { ProblemCell } from '@libs/contests';

export class RankingUserResponse {
  id!: string;
  username!: string;
  /** Null while unrated. */
  rating!: number | null;
  /** Short name of the user's first organization when it is listed, null otherwise. */
  organization!: string | null;
}

export class RankingProblemResponse {
  problemId!: string;
  code!: string;
  label!: string;
  points!: number;
  /** The live participation credited with the first solve. */
  firstSolve!: string | null;
  /** Participants whose cell is worth the full points. */
  acceptedCount!: number;
}

export class RankingRowResponse {
  /** Null on a board that shows only the viewer's row. */
  rank!: number | null;
  /** Id of the participation. */
  participationId!: string;
  /** The participant. */
  user!: RankingUserResponse;
  /** 0 live, -1 spectate, n at least 1 virtual. */
  virtual!: number;
  /** Whether the participation was disqualified. */
  isDisqualified!: boolean;
  /** Total score. */
  score!: number;
  /** Cumulative time (penalty) in seconds. */
  cumtime!: number;
  /** Tiebreak value used when scores and times are equal. */
  tiebreaker!: number;
  /** Per problem id, the format's cell; the frozen cells while frozen. */
  @ApiProblemCells()
  cells!: Record<string, ProblemCell>;
}

export class RankingResponse {
  /** Whether the standings shown are the frozen ones. */
  frozen!: boolean;
  /** The contest's problem columns in order. */
  problems!: RankingProblemResponse[];
  /** Participants, best first. */
  rows!: RankingRowResponse[];
}
