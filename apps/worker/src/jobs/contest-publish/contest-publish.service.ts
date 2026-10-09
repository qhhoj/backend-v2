import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { hasPermission } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { REDIS, runCoalesced } from '@libs/common';
import {
  CONTRIBUTION_POINTS_QUEUE,
  notifyContributionPoints,
} from '@libs/community';
import type { ContributionPointsJob } from '@libs/community';
import { contestPhase } from '@libs/contests';
import { uuidStr } from '@libs/database';
import type { Problem } from '@libs/database';
import { notifyRescore, PROBLEM_RESCORE_QUEUE } from '@libs/judging';
import type { ProblemRescoreJob } from '@libs/judging';
import {
  isEditorialReleased,
  ProblemAccess,
  publishVerdict,
} from '@libs/problems';
import type { PublishOutcome } from '@libs/problems';
import { ContestPublishRepository } from './contest-publish.repository';
import type { PublishableContest } from './contest-publish.repository';

export type AutoPublishResult = 'published' | 'failed' | 'skipped';
type FailureReason = 'actor_unavailable' | 'no_permission';
interface PublishContext {
  actor: Principal;
  now: Date;
}

/** Publishes a contest's problems and editorials at its end for the editor who switched the switch on, after re-checking that editor's account and rights now. The api's `ProblemEvents` are unreachable from the worker, so the two jobs its listeners enqueue (rescore, contribution points) are enqueued here. */
@Injectable()
export class ContestPublishService {
  private readonly logger = new Logger(ContestPublishService.name);

  constructor(
    private readonly repository: ContestPublishRepository,
    @InjectQueue(PROBLEM_RESCORE_QUEUE)
    private readonly rescores: Queue<ProblemRescoreJob>,
    @InjectQueue(CONTRIBUTION_POINTS_QUEUE)
    private readonly contributions: Queue<ContributionPointsJob>,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Serialised per contest across processes; the delayed job and the sweep may both arrive, the second finds the outcome set. */
  async run(contestId: string, now = new Date()): Promise<AutoPublishResult> {
    let result: AutoPublishResult | undefined;
    await runCoalesced(this.redis, `contest-publish:${contestId}`, async () => {
      // `runCoalesced` re-runs the work when a second caller arrived meanwhile; that re-run finds the outcome set and answers 'skipped'. Keep the first run's answer so `sweep` counts what was really handled.
      result ??= await this.publishContest(contestId, now);
    });
    return result ?? 'skipped';
  }

  /** Every minute: ended contests still due (a lost delayed job, a switch turned on after the end). Returns how many it handled. */
  async sweep(now = new Date()): Promise<number> {
    let handled = 0;
    for (const contestId of await this.repository.dueContestIds(now))
      if ((await this.run(contestId, now)) !== 'skipped') handled += 1;
    return handled;
  }

  private async publishContest(
    contestId: string,
    now: Date,
  ): Promise<AutoPublishResult> {
    const contest = await this.repository.findContest(contestId);
    if (!contest || !this.isDue(contest, now)) return 'skipped';
    const actor =
      contest.publishAfterEndBy === null
        ? null
        : await this.repository.actorOf(uuidStr(contest.publishAfterEndBy));
    if (!actor) return this.fail(contest, 'actor_unavailable', now);
    if (!hasPermission(actor, 'judge.change_public_visibility'))
      return this.fail(contest, 'no_permission', now);
    const tally = { published: 0, skipped: 0 };
    for (const entry of contest.problems) {
      const outcome = await this.publishOne(contest, uuidStr(entry.problem), {
        actor,
        now,
      });
      if (outcome === 'published') tally.published += 1;
      if (outcome === 'skipped') tally.skipped += 1;
    }
    await this.repository.recordOutcome(contest._id, {
      at: now,
      status: 'published',
      reason: '',
      ...tally,
    });
    return 'published';
  }

  private isDue(contest: PublishableContest, now: Date): boolean {
    return (
      contest.publishAfterEnd &&
      contest.autoPublishOutcome === null &&
      contestPhase(contest, now) === 'ended'
    );
  }

  private async publishOne(
    contest: PublishableContest,
    problemId: string,
    context: PublishContext,
  ): Promise<PublishOutcome> {
    const problem = await this.repository.findProblem(problemId);
    const verdict = publishVerdict(context.actor, problem);
    if (!problem) return verdict.outcome;
    if (verdict.outcome === 'published')
      await this.publishProblem(contest, problem, context.actor);
    if (verdict.outcome !== 'skipped')
      await this.releaseEditorial(problem, context);
    return verdict.outcome;
  }

  private async publishProblem(
    contest: PublishableContest,
    problem: Problem,
    actor: Principal,
  ): Promise<void> {
    const problemId = uuidStr(problem._id);
    const isPublished = await this.repository.publishProblem(problemId, {
      contestKey: contest.key,
      actorId: actor.userId,
    });
    if (!isPublished) return;
    await notifyRescore(this.rescores, problemId, this.logger);
    if (problem.suggester)
      await notifyContributionPoints(
        this.contributions,
        this.redis,
        [uuidStr(problem.suggester)],
        this.logger,
      );
  }

  /** Only for problems the editor may edit, and only a solution that is not already released. */
  private async releaseEditorial(
    problem: Problem,
    { actor, now }: PublishContext,
  ): Promise<void> {
    const mayEdit = ProblemAccess.canEdit(
      actor,
      ProblemAccess.accessView(problem),
    );
    if (
      !mayEdit ||
      !problem.solution ||
      isEditorialReleased(problem.solution, now)
    )
      return;
    await this.repository.releaseEditorial(problem, {
      actorId: actor.userId,
      now,
    });
  }

  /** Nothing is published; the contest keeps the reason (shown by the actions status) and the log carries it for the operator, until notifications exist. */
  private async fail(
    contest: PublishableContest,
    reason: FailureReason,
    now: Date,
  ): Promise<'failed'> {
    await this.repository.recordOutcome(contest._id, {
      at: now,
      status: 'failed',
      reason,
      published: 0,
      skipped: contest.problems.length,
    });
    this.logger.warn(
      JSON.stringify({
        event: 'contest-auto-publish-failed',
        contestKey: contest.key,
        actorId:
          contest.publishAfterEndBy && uuidStr(contest.publishAfterEndBy),
        reason,
      }),
    );
    return 'failed';
  }
}
