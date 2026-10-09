import { ApiProperty } from '@nestjs/swagger';
import type { ContestActionState } from '@libs/contests';

export const CONTEST_ACTION_STATES = ['queued', 'running', 'idle'] as const;
const ACTION_STATE = {
  enum: CONTEST_ACTION_STATES,
  enumName: 'ContestActionState',
};

/** Each editor action's state for the contest: `queued` waits for the worker, `running` is being worked on now. Failed and completed jobs are removed, so a failed action reads `idle`. */
export class ContestActionsResponse {
  @ApiProperty(ACTION_STATE) rescore!: ContestActionState;
  @ApiProperty(ACTION_STATE) judgeFinal!: ContestActionState;
  @ApiProperty(ACTION_STATE) rate!: ContestActionState;
}
