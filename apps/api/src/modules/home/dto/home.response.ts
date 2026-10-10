import type { OrganizationSummaryResponse } from '../../organizations/core/dto/organization.response';
import type { RecentCommentResponse } from '../../comments/core/dto/recent-comment.response';

export class HomeProblemResponse {
  /** Problem code. */
  code!: string;
  /** Problem name. */
  name!: string;
  /** Points the problem is worth. */
  points!: number;
  /** When the problem was added. */
  date!: Date;
}

export class HomeUserResponse {
  /** Login name. */
  username!: string;
  /** Rank title such as `user` or `admin`. */
  displayRank!: string;
  /** Contest rating; null while unrated. */
  rating!: number | null;
  /** Performance points. */
  performancePoints!: number;
  /** Contribution points. */
  contributionPoints!: number;
  /** The user's first listed organization, whoever views; null when none is listed. */
  organization!: OrganizationSummaryResponse | null;
}

export class HomeCountsResponse {
  /** Accounts on the site (an estimate). */
  users!: number;
  /** Problems in the archive. */
  problems!: number;
  /** Submissions made (an estimate). */
  submissions!: number;
  /** Contests an anonymous visitor can see. */
  contests!: number;
  /** Programming languages available. */
  languages!: number;
}

/** Legacy `PostList` side widgets; running and upcoming contests come from `GET /contests?phase=`. */
export class HomeResponse {
  /** Newest comments the viewer may read. */
  recentComments!: RecentCommentResponse[];
  /** The 7 newest problems. */
  newProblems!: HomeProblemResponse[];
  /** Top 5 users by performance points. */
  topPerformers!: HomeUserResponse[];
  /** Top 5 users by contribution points. */
  topContributors!: HomeUserResponse[];
  /** Site-wide totals. */
  counts!: HomeCountsResponse;
}
