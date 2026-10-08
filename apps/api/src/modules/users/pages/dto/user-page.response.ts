import { ApiProperty } from '@nestjs/swagger';
import { ProblemRefResponse } from '../../../problems/core/dto/problem-ref.response';
import { OrganizationSummaryResponse } from '../../../organizations/core/dto/organization.response';

export class RatingSummaryResponse {
  min!: number;
  max!: number;
  contests!: number;
}

export class UserPageResponse {
  id!: string;
  username!: string;
  displayName!: string;
  displayRank!: string;
  aboutHtml!: string;
  points!: number;
  performancePoints!: number;
  problemCount!: number;
  contributionPoints!: number;
  rating!: number | null;
  /** Among listed, active users by performance points. */
  rank!: number;
  /** Null while the user is unrated. */
  ratingRank!: number | null;
  ratingSummary!: RatingSummaryResponse | null;
  organizations!: OrganizationSummaryResponse[];
  dateJoined!: Date;
}

export class RatingHistoryEntryResponse {
  /** Null when the viewer may not see the contest. */
  contestKey!: string | null;
  contestName!: string | null;
  endTime!: Date;
  /** Rating, rank and performance are null while the viewer may not read the contest's board (hidden or frozen). */
  rating!: number | null;
  rank!: number | null;
  performance!: number | null;
}

export class SolvedProblemResponse {
  code!: string;
  name!: string;
  points!: number;
  total!: number;
}

export class SolvedGroupResponse {
  name!: string;
  points!: number;
  problems!: SolvedProblemResponse[];
}

export class SolvedResponse {
  groups!: SolvedGroupResponse[];
}

export class PpSubmissionResponse {
  id!: string;
  date!: string;
  casePoints!: number;
  caseTotal!: number;
  result!: string | null;
  language!: string;
}

export class PpEntryResponse {
  rank!: number;
  /** Percent of the points counted, 100 for the best problem. */
  weight!: number;
  points!: number;
  scaledPoints!: number;
  problem!: ProblemRefResponse;
  submission!: PpSubmissionResponse;
}

export class ActivityResponse {
  timezone!: string;
  /** ISO; identical whether served from the cache or not. */
  since!: string;
  /** `YYYY-MM-DD` in `timezone` to submission count. */
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } })
  days!: Record<string, number>;
}
