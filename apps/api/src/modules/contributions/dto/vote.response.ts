import { ApiProperty } from '@nestjs/swagger';
import { VOTE_SCORES } from '@libs/community';
import type { VoteScore } from '@libs/community';

export class VoteResponse {
  score!: number;
  /** The caller's vote after this call. */
  @ApiProperty({ enum: VOTE_SCORES, enumName: 'VoteScore' })
  viewerVote!: VoteScore;
}
