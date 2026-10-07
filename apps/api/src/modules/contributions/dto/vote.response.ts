import type { VoteScore } from '@libs/community';

export class VoteResponse {
  score!: number;
  viewerVote!: VoteScore;
}
