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
  acceptedCount!: number;
}

export class RankingRowResponse {
  /** Null on a board that shows only the viewer's row. */
  rank!: number | null;
  participationId!: string;
  user!: RankingUserResponse;
  virtual!: number;
  isDisqualified!: boolean;
  score!: number;
  cumtime!: number;
  tiebreaker!: number;
  /** Per problem id, the format's cell; the frozen cells while frozen. */
  cells!: Record<string, ProblemCell>;
}

export class RankingResponse {
  frozen!: boolean;
  problems!: RankingProblemResponse[];
  rows!: RankingRowResponse[];
}
