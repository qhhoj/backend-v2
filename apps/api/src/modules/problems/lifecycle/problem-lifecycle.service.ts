import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { UsersRepository } from '@libs/auth';
import type { AuthContext, Principal } from '@libs/auth';
import {
  invalidField,
  Paginated,
  RateLimitService,
  unique,
} from '@libs/common';
import { PROBLEM_CODE_PATTERN, uuidStr } from '@libs/database';
import {
  enqueuePurge,
  notifySolversRecompute,
  PROBLEM_PURGE_QUEUE,
  PROBLEM_SOLVERS_QUEUE,
} from '@libs/problems';
import type {
  ProblemPurgeJob,
  ProblemSolversJob,
  SolversRecomputeReason,
} from '@libs/problems';
import { SettingsService } from '@libs/settings';
import { ContestsRepository } from '../../contests/core/contests.repository';
import { ProblemAccess } from '../core/problem-access';
import { ProblemEvents } from '../core/problem.events';
import { ProblemEditPolicyService } from '../editing/problem-edit-policy.service';
import { ProblemsRepository } from '../core/problems.repository';
import type { ProblemDocument } from '../core/problems.repository';
import { RevisionsRepository } from '../core/revisions.repository';
import type { DeletedListQueryDto } from './dto/deleted-list.dto';
import { DeletedProblemResponse } from './dto/deleted-problem.response';
import type { PurgeQueuedResponse } from './dto/purge-queued.response';
import { refusal } from './lifecycle-refusals';
import { DELETE_LIMIT, DELETE_WINDOW_SECONDS } from './lifecycle-rate-limits';

const notFound = () => refusal('not_found', 404, 'No such problem');

function assertTyped(code: string, confirmCode: string): void {
  if (confirmCode !== code)
    throw invalidField('confirmCode', 'Type the problem code to confirm.');
}

/** Soft delete with a grace period: delete hides at once, restore brings it back until the purge job takes the heavy data (and leaves a tombstone). Submissions are never touched here. */
@Injectable()
export class ProblemLifecycleService {
  private readonly logger = new Logger(ProblemLifecycleService.name);

  constructor(
    private readonly policy: ProblemEditPolicyService,
    private readonly problems: ProblemsRepository,
    private readonly contests: ContestsRepository,
    private readonly revisions: RevisionsRepository,
    private readonly users: UsersRepository,
    private readonly rateLimit: RateLimitService,
    private readonly settings: SettingsService,
    @InjectQueue(PROBLEM_SOLVERS_QUEUE)
    private readonly solvers: Queue<ProblemSolversJob>,
    @InjectQueue(PROBLEM_PURGE_QUEUE)
    private readonly purges: Queue<ProblemPurgeJob>,
    private readonly events: ProblemEvents,
  ) {}

  async remove(
    auth: AuthContext,
    code: string,
    confirmCode: string,
    now = new Date(),
  ): Promise<void> {
    const { principal } = auth;
    const problem = await this.policy.editableProblem(principal, code);
    assertTyped(problem.code, confirmCode);
    await this.rateLimit.reserve(
      [`problem-delete:user:${principal.userId}`],
      DELETE_LIMIT,
      DELETE_WINDOW_SECONDS,
    );
    if (await this.contests.isProblemInAnyContest(problem._id))
      throw refusal(
        'problem_in_contest',
        409,
        'Remove the problem from its contests before deleting it',
      );
    if (!(await this.problems.markDeleted(problem._id, principal.userId, now)))
      throw notFound();
    await this.rollBackIfAdded(problem);
    await this.record(principal, problem, { action: 'delete', at: now });
    await this.notifyEffects(problem, 'deleted');
  }

  /** The contest check above and `markDeleted` are two steps, so a contest edit can add the problem between them (preflight M12): check again and undo. */
  private async rollBackIfAdded(problem: ProblemDocument): Promise<void> {
    if (!(await this.contests.isProblemInAnyContest(problem._id))) return;
    await this.problems.restore(problem._id);
    throw refusal(
      'problem_in_contest',
      409,
      'Remove the problem from its contests before deleting it',
    );
  }

  /** Delete and restore both move the solvers' points, and both change who can see the problem as `publicityChanged` does: its listeners drop the public submission feed's cached eligibility at once, rescore, and move the suggester's contribution points (a suggested problem counts only while it is live and public). */
  private async notifyEffects(
    problem: ProblemDocument,
    reason: SolversRecomputeReason,
  ): Promise<void> {
    await notifySolversRecompute(
      this.solvers,
      { problemId: problem._id, reason },
      this.logger,
    );
    this.events.emit(
      'publicityChanged',
      problem._id,
      problem.suggester ? uuidStr(problem.suggester) : null,
    );
  }

  async restore(auth: AuthContext, code: string): Promise<void> {
    const problem = await this.deletedProblemOf(auth.principal, code);
    if (
      problem.purgedAt ||
      problem.purgeStartedAt ||
      !(await this.problems.restore(problem._id))
    )
      throw refusal(
        'purged',
        409,
        'The problem was purged and cannot be restored',
      );
    await this.record(auth.principal, problem, {
      action: 'restore',
      at: new Date(),
    });
    await this.notifyEffects(problem, 'restored');
  }

  /** Superuser only; the worker does the purge, the problem keeps its tombstone and all submissions. The structured line is the record of who asked. */
  async purgeNow(
    auth: AuthContext,
    code: string,
    confirmCode: string,
  ): Promise<PurgeQueuedResponse> {
    if (!auth.principal.isSuperuser)
      throw refusal('forbidden', 403, 'Only a superuser can purge now');
    const problem = await this.deletedProblemOf(auth.principal, code);
    if (problem.purgedAt)
      throw refusal('purged', 409, 'The problem was already purged');
    // A purge that was claimed but not finished is queued again on purpose: the job completes it.
    assertTyped(problem.code, confirmCode);
    await enqueuePurge(this.purges, problem._id);
    this.logger.warn(
      JSON.stringify({
        event: 'problem-purge-requested',
        problemId: problem._id,
        code: problem.code,
        actorId: auth.principal.userId,
      }),
    );
    return { queued: true };
  }

  async list(
    principal: Principal,
    { page, pageSize }: DeletedListQueryDto,
    now = new Date(),
  ): Promise<Paginated<DeletedProblemResponse>> {
    const { items, total } = await this.problems.deletedPage(
      ProblemAccess.visibleFilter(principal, null),
      page,
      pageSize,
    );
    const graceDays = this.settings.get('problem.deleteGraceDays');
    const people = new Map(
      (
        await this.users.findByIds(
          unique(
            items.flatMap((row) =>
              row.deletedBy ? [uuidStr(row.deletedBy)] : [],
            ),
          ),
        )
      ).map((user) => [user._id, user]),
    );
    return new Paginated(
      items.map((row) =>
        DeletedProblemResponse.from(row, {
          deletedBy: row.deletedBy
            ? people.get(uuidStr(row.deletedBy))
            : undefined,
          graceDays,
          now,
        }),
      ),
      { page, pageSize, total },
    );
  }

  /** The deleted problem by code. A live problem is `not_deleted` when the caller could see it and 404 when not; an invisible deleted one is 404, a visible one they cannot edit is 403 (the same existence rule as every problem route). */
  private async deletedProblemOf(
    principal: Principal,
    code: string,
  ): Promise<ProblemDocument> {
    const isCode = PROBLEM_CODE_PATTERN.test(code);
    const deleted = isCode ? await this.problems.findDeletedByCode(code) : null;
    if (deleted) return this.assertMayManage(principal, deleted);
    const live = isCode ? await this.problems.findByCode(code) : null;
    const view = live && ProblemAccess.accessView(live);
    if (view && ProblemAccess.canSee(principal, view, null))
      throw refusal('not_deleted', 409, 'The problem is not deleted');
    throw notFound();
  }

  private assertMayManage(
    principal: Principal,
    problem: ProblemDocument,
  ): ProblemDocument {
    const view = ProblemAccess.accessView(problem);
    if (!ProblemAccess.canSee(principal, view, null)) throw notFound();
    if (!ProblemAccess.canEdit(principal, view))
      throw refusal('forbidden', 403, 'You cannot manage this problem');
    return problem;
  }

  private async record(
    principal: Principal,
    problem: ProblemDocument,
    change: { action: 'delete' | 'restore'; at: Date },
  ): Promise<void> {
    const isDelete = change.action === 'delete';
    await this.revisions.append({
      entity: 'problem',
      entityId: problem._id,
      action: change.action,
      userId: principal.userId,
      changes: {
        deletedAt: {
          before: isDelete ? null : problem.deletedAt,
          after: isDelete ? change.at : null,
        },
      },
      comment: isDelete ? 'Deleted from site' : 'Restored from site',
    });
  }
}
