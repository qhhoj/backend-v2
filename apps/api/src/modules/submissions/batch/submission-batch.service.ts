import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { hasPermission, UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError, unique } from '@libs/common';
import { CONTEST_RESCORE_QUEUE, enqueueContestRescore } from '@libs/contests';
import type { ContestRescoreJob } from '@libs/contests';
import { SUBMISSION_PRIORITY, uuidStr } from '@libs/database';
import type { Revision, Submission } from '@libs/database';
import {
  BridgeCommandsService,
  enqueueRescores,
  PROBLEM_RESCORE_QUEUE,
} from '@libs/judging';
import type { ProblemRescoreJob } from '@libs/judging';
import type { FilterQuery } from 'mongoose';
import { BULK_REJUDGE_LIMIT } from '../core/rate-limits';
import { SubmissionsRepository } from '../core/submissions.repository';
import { SubmissionsService } from '../core/submissions.service';
import { rejudgeFilter, rescoreFilter } from './batch-filter';
import type { BatchRefs } from './batch-filter';
import { BatchLogRepository } from './batch-log.repository';
import { BatchScopeService } from './batch-scope.service';
import type {
  BatchAction,
  BulkRejudgeDto,
  BulkRejudgeResponse,
  BulkRescoreDto,
  BulkRescoreResponse,
  SubmissionBatchFilterDto,
  SubmissionBatchLogResponse,
} from './dto/submission-batch.dto';

/** Matches a dry run shows to sanity-check a batch. */
const SAMPLE_SIZE = 5;
/** Batch log entries `recent` returns. */
const LOG_SIZE = 20;

/** The filter as stored in the log: no run flags. */
const loggedFilter = (
  dto: SubmissionBatchFilterDto & { dryRun?: boolean },
): SubmissionBatchFilterDto =>
  Object.fromEntries(Object.entries(dto).filter(([key]) => key !== 'dryRun'));

/** Legacy changelist `judge` and `recalculate_score` actions over any filter; every run is logged. */
@Injectable()
export class SubmissionBatchService {
  constructor(
    private readonly scopes: BatchScopeService,
    private readonly submissions: SubmissionsRepository,
    private readonly lists: SubmissionsService,
    private readonly commands: BridgeCommandsService,
    private readonly log: BatchLogRepository,
    private readonly users: UsersRepository,
    @InjectQueue(PROBLEM_RESCORE_QUEUE)
    private readonly problemRescores: Queue<ProblemRescoreJob>,
    @InjectQueue(CONTEST_RESCORE_QUEUE)
    private readonly contestRescores: Queue<ContestRescoreJob>,
  ) {}

  /** Matches at batch priority; publishes no events (up to 100k `queued` would flood every feed; pages see `processing` from the bridge); above `BULK_REJUDGE_LIMIT` needs `judge.rejudge_submission_lot`. */
  async rejudge(
    principal: Principal,
    dto: BulkRejudgeDto,
  ): Promise<BulkRejudgeResponse> {
    const filter = rejudgeFilter(
      await this.scopes.authorize(principal, dto),
      dto,
    );
    const matching = await this.submissions.countMatching(filter);
    const allowed =
      matching <= BULK_REJUDGE_LIMIT ||
      hasPermission(principal, 'judge.rejudge_submission_lot');
    if (dto.dryRun)
      return {
        count: matching,
        dryRun: true,
        allowed,
        sample: await this.sampleOf(principal, filter),
      };
    if (!allowed)
      throw new AppError(
        'forbidden',
        403,
        `Rejudging more than ${BULK_REJUDGE_LIMIT} submissions needs judge.rejudge_submission_lot`,
      );
    const count = await this.rejudgeChunks(filter);
    await this.record(principal, 'rejudge', count, dto);
    return { count, dryRun: false, allowed, sample: [] };
  }

  /** A contest scope recomputes that contest's results; otherwise every matched problem is rescored (its submissions' points from their case totals, then its users, stats and contests), so the effect reaches all of a problem's submissions, which is what a points change needs. */
  async rescore(
    principal: Principal,
    dto: BulkRescoreDto,
  ): Promise<BulkRescoreResponse> {
    const refs = await this.scopes.authorize(principal, dto);
    const filter = rescoreFilter(refs, dto);
    const [count, problemIds] = await Promise.all([
      this.submissions.countMatching(filter),
      refs.contestId ? [] : this.submissions.problemIdsOf(filter),
    ]);
    const contests = refs.contestId && count ? 1 : 0;
    const result = { count, problems: problemIds.length, contests };
    if (dto.dryRun) return { ...result, dryRun: true };
    await this.queueRescores(refs, problemIds, count);
    await this.record(principal, 'rescore', count, dto);
    return { ...result, dryRun: false };
  }

  /** The newest batch runs with who ran them. Their filters name contests, problems and users, so only `judge.edit_all_problem` sees everyone's runs; others see their own. */
  async recent(principal: Principal): Promise<SubmissionBatchLogResponse[]> {
    const rows = await this.log.recent(
      LOG_SIZE,
      hasPermission(principal, 'judge.edit_all_problem')
        ? undefined
        : principal.userId,
    );
    const userIds = unique(
      rows.flatMap((row) => (row.userId ? [uuidStr(row.userId)] : [])),
    );
    const users = new Map(
      (await this.users.findByIds(userIds)).map((user) => [
        user._id,
        user.username,
      ]),
    );
    return rows.map((row) => logView(row, users));
  }

  private async queueRescores(
    refs: BatchRefs,
    problemIds: string[],
    count: number,
  ): Promise<void> {
    if (refs.contestId) {
      if (count)
        await enqueueContestRescore(this.contestRescores, refs.contestId);
      return;
    }
    if (problemIds.length)
      await enqueueRescores(this.problemRescores, problemIds);
  }

  private async sampleOf(
    principal: Principal,
    filter: FilterQuery<Submission>,
  ) {
    return this.lists.listItems(
      await this.submissions.newest(filter, SAMPLE_SIZE),
      principal,
      { testSummaries: false },
    );
  }

  /** The command may carry ids that raced into P/G; the bridge only loads queued ones. */
  private async rejudgeChunks(
    filter: FilterQuery<Submission>,
  ): Promise<number> {
    let count = 0;
    for await (const ids of this.submissions.idChunks(filter)) {
      count += await this.submissions.resetForJudging(
        ids,
        SUBMISSION_PRIORITY.batchRejudge,
      );
      await this.commands.judge(ids);
    }
    return count;
  }

  private record(
    principal: Principal,
    action: BatchAction,
    count: number,
    dto: SubmissionBatchFilterDto,
  ): Promise<void> {
    return this.log.append({
      action,
      userId: principal.userId,
      count,
      filter: loggedFilter(dto),
    });
  }
}

function logView(
  row: Revision,
  usernames: Map<string, string>,
): SubmissionBatchLogResponse {
  const userId = row.userId ? uuidStr(row.userId) : null;
  return {
    id: uuidStr(row._id),
    action: row.action as BatchAction,
    user: userId
      ? { id: userId, username: usernames.get(userId) ?? null }
      : null,
    count: Number(row.changes.count?.after ?? 0),
    filter: row.changes.filter?.after ?? {},
    createdAt: row.createdAt,
  };
}
