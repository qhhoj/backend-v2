/** A vote: +1, -1, or 0 to withdraw. */
export const VOTE_SCORES = [-1, 0, 1] as const;
export type VoteScore = (typeof VOTE_SCORES)[number];
