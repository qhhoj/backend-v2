import type { ContestActionState } from '@libs/contests';

/** Each editor action's state for the contest: `queued` waits for the worker, `running` is being worked on now. Failed and completed jobs are removed, so a failed action reads `idle`. */
export class ContestActionsResponse {
  rescore!: ContestActionState;
  judgeFinal!: ContestActionState;
  rate!: ContestActionState;
}
