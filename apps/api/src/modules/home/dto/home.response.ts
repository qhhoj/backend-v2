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
}

export class HomeCountsResponse {
  users!: number;
  problems!: number;
  submissions!: number;
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
