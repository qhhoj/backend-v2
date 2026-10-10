import type { UserDocument } from '@libs/auth';
import type { Problem } from '@libs/database';
import { UserSummaryResponse } from '../../core/dto/user-summary.response';
import { daysLeft } from '../problem-lifecycle-rules';

export class DeletedProblemResponse {
  /** Problem code. */
  code!: string;
  /** Problem title. */
  name!: string;
  /** When the problem was deleted. */
  deletedAt!: Date;
  /** Who deleted it; null when unknown. */
  deletedBy!: UserSummaryResponse | null;
  /** Whole days before the purge job may take it; 0 once the grace period is over. */
  daysLeft!: number;
  /** The heavy data is gone; only the tombstone (code and name) stays and it cannot be restored. */
  isPurged!: boolean;

  static from(
    problem: Pick<Problem, 'code' | 'name' | 'deletedAt' | 'purgedAt'>,
    context: {
      deletedBy: UserDocument | undefined;
      graceDays: number;
      now: Date;
    },
  ): DeletedProblemResponse {
    const deletedAt = problem.deletedAt!;
    return {
      code: problem.code,
      name: problem.name,
      deletedAt,
      deletedBy: context.deletedBy
        ? UserSummaryResponse.from(context.deletedBy)
        : null,
      daysLeft: daysLeft(deletedAt, context.graceDays, context.now),
      isPurged: problem.purgedAt != null,
    };
  }
}
