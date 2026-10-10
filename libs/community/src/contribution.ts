/** Legacy `VNOJ_CP_COMMENT`: per vote point on own comments and personal posts. */
export const CONTRIBUTION_PER_VOTE = 1;
/** Legacy `VNOJ_CP_TICKET`: per good ticket (counted by the contribution-points job). */
export const CONTRIBUTION_PER_GOOD_TICKET = 10;
/** Legacy `VNOJ_CP_PROBLEM`. */
export const CONTRIBUTION_PER_PUBLIC_SUGGESTION = 20;

export interface ContributionTotals {
  /** Score of own comments that are neither hidden nor deleted. */
  commentScore: number;
  /** Score of own visible posts without an organization. */
  postScore: number;
  goodTickets: number;
  publicSuggestions: number;
}

/** Legacy `Profile.calculate_contribution_points`. */
export const contributionPoints = (totals: ContributionTotals): number =>
  (totals.commentScore + totals.postScore) * CONTRIBUTION_PER_VOTE +
  totals.goodTickets * CONTRIBUTION_PER_GOOD_TICKET +
  totals.publicSuggestions * CONTRIBUTION_PER_PUBLIC_SUGGESTION;
