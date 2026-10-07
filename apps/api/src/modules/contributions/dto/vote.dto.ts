import { IsIn } from 'class-validator';
import { VOTE_SCORES } from '@libs/community';
import type { VoteScore } from '@libs/community';

export class VoteDto {
  /** +1, -1, or 0 to withdraw. */
  @IsIn(VOTE_SCORES) score!: VoteScore;
}
