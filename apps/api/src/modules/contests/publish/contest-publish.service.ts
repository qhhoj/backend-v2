import { Injectable } from '@nestjs/common';
import type { AuthContext, Principal } from '@libs/auth';
import { AppError, RateLimitService } from '@libs/common';
import { contestPhase } from '@libs/contests';
import { uuidStr } from '@libs/database';
import {
  isEditorialReleased,
  ProblemAccess,
  publishVerdict,
} from '@libs/problems';
import type { PublishVerdict } from '@libs/problems';
import { ProblemEditingService } from '../../problems/editing/problem-editing.service';
import { ProblemsRepository } from '../../problems/core/problems.repository';
import type { ProblemDocument } from '../../problems/core/problems.repository';
import { RevisionsRepository } from '../../problems/core/revisions.repository';
import { ContestsService } from '../core/contests.service';
import type {
  EditorialOutcome,
  PublishedProblemResponse,
  PublishProblemsResponse,
} from './dto/publish-problems.response';
import { PUBLISH_LIMIT, PUBLISH_WINDOW_SECONDS } from './publish-rate-limits';

export interface PublishOptions {
  editorials: boolean;
  dryRun: boolean;
}
interface PublishRun extends PublishOptions {
  now: Date;
}

/** After the contest ends, an editor makes its problems (and editorials) public. Every problem is judged by `publishVerdict`, the same decision the automatic job uses; the writes go through the problem editing service, so the `publicityChanged` listeners (rescore, points) fire and a revision is written. */
@Injectable()
export class ContestPublishService {
  constructor(
    private readonly contestsService: ContestsService,
    private readonly problems: ProblemsRepository,
    private readonly editing: ProblemEditingService,
    private readonly revisions: RevisionsRepository,
    private readonly rateLimit: RateLimitService,
  ) {}

  async publish(
    auth: AuthContext,
    key: string,
    options: PublishOptions,
    now = new Date(),
  ): Promise<PublishProblemsResponse> {
    const contest = await this.contestsService.editableContest(
      auth.principal,
      key,
    );
    if (contestPhase(contest, now) !== 'ended')
      throw new AppError(
        'contest_not_ended',
        409,
        'Problems can be published after the contest ends',
      );
    if (!options.dryRun)
      await this.rateLimit.reserve(
        [`contest-publish:user:${auth.principal.userId}`],
        PUBLISH_LIMIT,
        PUBLISH_WINDOW_SECONDS,
      );
    const items: PublishedProblemResponse[] = [];
    for (const entry of [...contest.problems].sort(
      (left, right) => left.order - right.order,
    ))
      items.push(
        await this.publishOne(auth, uuidStr(entry.problem), {
          ...options,
          now,
        }),
      );
    return { dryRun: options.dryRun, items };
  }

  private async publishOne(
    auth: AuthContext,
    problemId: string,
    run: PublishRun,
  ): Promise<PublishedProblemResponse> {
    const problem = await this.problems.findById(problemId);
    const verdict = await this.applied(auth, problem, run);
    const editorial =
      run.editorials && problem
        ? await this.editorialOutcome(auth.principal, problem, verdict, run)
        : null;
    return {
      problemId,
      code: problem?.code ?? null,
      outcome: verdict.outcome,
      reason: verdict.reason,
      editorial,
    };
  }

  /** The verdict, after the write it asks for (none in a dry run). A 403/404 from the editing policy means the rights changed since the verdict. */
  private async applied(
    auth: AuthContext,
    problem: ProblemDocument | null,
    run: PublishRun,
  ): Promise<PublishVerdict> {
    const verdict = publishVerdict(auth.principal, problem);
    if (verdict.outcome !== 'published' || run.dryRun || !problem)
      return verdict;
    try {
      await this.editing.edit(auth, problem.code, { isPublic: true });
      return verdict;
    } catch (error) {
      if (error instanceof AppError && [403, 404].includes(error.status))
        return { outcome: 'skipped', reason: 'no_permission' };
      throw error;
    }
  }

  private async editorialOutcome(
    principal: Principal,
    problem: ProblemDocument,
    verdict: PublishVerdict,
    run: PublishRun,
  ): Promise<EditorialOutcome> {
    const mayEdit = ProblemAccess.canEdit(
      principal,
      ProblemAccess.accessView(problem),
    );
    if (verdict.outcome === 'skipped' || !mayEdit) return 'skipped';
    if (!problem.solution) return 'none';
    if (isEditorialReleased(problem.solution, run.now)) return 'unchanged';
    if (!run.dryRun) await this.releaseEditorial(principal, problem, run.now);
    return 'published';
  }

  /** Public from now on; the revision keeps who and when. */
  private async releaseEditorial(
    principal: Principal,
    problem: ProblemDocument,
    now: Date,
  ): Promise<void> {
    const before = problem.toObject().solution!;
    await this.problems.update(problem._id, {
      solution: { ...before, isPublic: true, publishOn: now },
    });
    await this.revisions.append({
      entity: 'problem',
      entityId: problem._id,
      action: 'editorial',
      userId: principal.userId,
      changes: {
        solution: {
          before: { isPublic: before.isPublic, publishOn: before.publishOn },
          after: { isPublic: true, publishOn: now },
        },
      },
      comment: 'Editorial published after contest',
    });
  }
}
