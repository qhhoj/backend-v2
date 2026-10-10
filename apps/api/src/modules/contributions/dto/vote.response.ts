import { ApiProperty } from '@nestjs/swagger';
import { VOTE_SCORES } from '@libs/community';
import type { VoteScore } from '@libs/community';

export class VoteResponse {
  /** The target's total score after the vote. */
  score!: number;
  /** The caller's vote after this call. */
  @ApiProperty({ enum: VOTE_SCORES, enumName: 'VoteScore' })
  viewerVote!: VoteScore;
}
