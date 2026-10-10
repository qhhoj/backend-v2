import { ApiProperty } from '@nestjs/swagger';
import { ProblemRefResponse } from '../../../problems/core/dto/problem-ref.response';
import { OrganizationSummaryResponse } from '../../../organizations/core/dto/organization.response';

export class RatingSummaryResponse {
  /** Lowest rating over the readable contests. */
  min!: number;
  /** Highest rating over the readable contests. */
  max!: number;
  /** Number of rated contests counted. */
  contests!: number;
}

/** Only for viewers who hold `judge.ban_user`; null for everyone else. */
export class UserPageStaffResponse {
  /** Whether the user is a superuser. */
  isSuperuser!: boolean;
  /** False for a never-activated account as well as a banned one; only an active account can be impersonated. */
  isActive!: boolean;
  /** Reason given when the user was banned; null if not banned. */
  banReason!: string | null;
}

export class UserPageResponse {
  /** User id. */
  id!: string;
  /** Login name. */
  username!: string;
  /** Name to show: the staff-set override, else the username. */
  displayName!: string;
  /** Rank title such as `user`, `admin` or `banned`. */
  displayRank!: string;
  /** Rendered, sanitised about-me HTML. */
  aboutHtml!: string;
  /** Total points earned from solved problems. */
  points!: number;
  /** Performance points (weighted best solves). */
  performancePoints!: number;
  /** Number of fully solved problems. */
  problemCount!: number;
  /** Points earned from community contributions. */
  contributionPoints!: number;
  /** Contest rating; null while unrated. */
  rating!: number | null;
  /** Among listed, active users by performance points. */
  rank!: number;
  /** Null while the user is unrated. */
  ratingRank!: number | null;
  /** Min, max and count of ratings the viewer may read; null when none. */
  ratingSummary!: RatingSummaryResponse | null;
  /** Listed organizations the user belongs to. */
  organizations!: OrganizationSummaryResponse[];
  /** When the account was created. */
  dateJoined!: Date;
  /** Moderation details; null unless the viewer holds `judge.ban_user`. */
  staff!: UserPageStaffResponse | null;
}

export class RatingHistoryEntryResponse {
  /** Null when the viewer may not see the contest. */
  contestKey!: string | null;
  contestName!: string | null;
  /** When the contest ended. */
  endTime!: Date;
  /** Rating, rank and performance are null while the viewer may not read the contest's board (hidden or frozen). */
  rating!: number | null;
  rank!: number | null;
  performance!: number | null;
}

export class SolvedProblemResponse {
  /** Problem code. */
  code!: string;
  /** Problem name. */
  name!: string;
  /** Points the user earned. */
  points!: number;
  /** Full points the problem is worth. */
  total!: number;
}

export class SolvedGroupResponse {
  /** Problem group name. */
  name!: string;
  /** Sum of the points earned in the group. */
  points!: number;
  /** Solved problems of the group, sorted by code. */
  problems!: SolvedProblemResponse[];
}

export class SolvedResponse {
  /** Groups sorted by name. */
  groups!: SolvedGroupResponse[];
}

export class PpSubmissionResponse {
  /** Submission id. */
  id!: string;
  /** When the submission was made, ISO 8601. */
  date!: string;
  /** Points scored on the test cases. */
  casePoints!: number;
  /** Total points of the test cases. */
  caseTotal!: number;
  /** Verdict code such as `AC`; null if none. */
  result!: string | null;
  /** Short name of the programming language. */
  language!: string;
}

export class PpEntryResponse {
  /** 1-based position among the user's best submissions. */
  rank!: number;
  /** Percent of the points counted, 100 for the best problem. */
  weight!: number;
  /** Raw points of the submission. */
  points!: number;
  /** Points after applying the weight. */
  scaledPoints!: number;
  /** The problem the submission solved. */
  problem!: ProblemRefResponse;
  /** The counted submission. */
  submission!: PpSubmissionResponse;
}

export class ActivityResponse {
  /** The time zone used for the days, as requested. */
  timezone!: string;
  /** ISO; identical whether served from the cache or not. */
  since!: string;
  /** `YYYY-MM-DD` in `timezone` to submission count. */
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } })
  days!: Record<string, number>;
}
