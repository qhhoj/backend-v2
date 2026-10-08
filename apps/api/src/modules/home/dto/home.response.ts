import type { OrganizationSummaryResponse } from '../../organizations/core/dto/organization.response';
import type { RecentCommentResponse } from '../../comments/core/dto/recent-comment.response';

export class HomeProblemResponse {
  code!: string;
  name!: string;
  points!: number;
  date!: Date;
}

export class HomeUserResponse {
  username!: string;
  displayRank!: string;
  rating!: number | null;
  performancePoints!: number;
  contributionPoints!: number;
  /** The user's first listed organization, whoever views; null when none is listed. */
  organization!: OrganizationSummaryResponse | null;
}

export class HomeCountsResponse {
  users!: number;
  problems!: number;
  submissions!: number;
  /** Contests an anonymous visitor can see. */
  contests!: number;
  languages!: number;
}

/** Legacy `PostList` side widgets; running and upcoming contests come from `GET /contests?phase=`. */
export class HomeResponse {
  recentComments!: RecentCommentResponse[];
  newProblems!: HomeProblemResponse[];
  topPerformers!: HomeUserResponse[];
  topContributors!: HomeUserResponse[];
  counts!: HomeCountsResponse;
}
