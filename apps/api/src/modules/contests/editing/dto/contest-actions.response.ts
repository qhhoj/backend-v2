import { ApiProperty } from '@nestjs/swagger';
import { AUTO_PUBLISH_STATUSES } from '@libs/database';
import type { ContestAutoPublishOutcome } from '@libs/database';
import type { ContestActionState } from '@libs/contests';

export const CONTEST_ACTION_STATES = ['queued', 'running', 'idle'] as const;
const ACTION_STATE = {
  enum: CONTEST_ACTION_STATES,
  enumName: 'ContestActionState',
};

/** What the automatic publish after the end did, recorded once by the worker. */
export class ContestAutoPublishResponse {
  at!: Date;
  @ApiProperty({
    enum: AUTO_PUBLISH_STATUSES,
    enumName: 'ContestAutoPublishStatus',
  })
  status!: ContestAutoPublishOutcome['status'];
  /** Empty on success; `no_permission` or `actor_unavailable` on a failure. */
  reason!: string;
  published!: number;
  skipped!: number;
}

/** Each editor action's state for the contest: `queued` waits for the worker, `running` is being worked on now. Failed and completed jobs are removed, so a failed action reads `idle`. `publish` is `queued` while the automatic publish is scheduled for the end or waits for the worker; its result is `autoPublish`. `replay` is a replay build waiting or running. `export` is the submissions export. */
export class ContestActionsResponse {
  @ApiProperty(ACTION_STATE) rescore!: ContestActionState;
  @ApiProperty(ACTION_STATE) judgeFinal!: ContestActionState;
  @ApiProperty(ACTION_STATE) rate!: ContestActionState;
  @ApiProperty(ACTION_STATE) publish!: ContestActionState;
  @ApiProperty(ACTION_STATE) replay!: ContestActionState;
  @ApiProperty(ACTION_STATE) export!: ContestActionState;
  autoPublish!: ContestAutoPublishResponse | null;
}
