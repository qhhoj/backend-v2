import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { hasPermission } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError, ENV } from '@libs/common';
import type { Env } from '@libs/common';
import {
  CONTEST_MOSS_JOB,
  CONTEST_MOSS_QUEUE,
  mossJobId,
  oneJobPerContest,
  problemLabel,
} from '@libs/contests';
import type { ContestMossJob } from '@libs/contests';
import { MOSS_LANGUAGES, uuidStr } from '@libs/database';
import { ProblemsRepository } from '../../problems/core/problems.repository';
import { ContestMossRepository } from './contest-moss.repository';
import { ContestsService } from '../core/contests.service';
import type { ContestMossResponse } from './dto/contest-moss.response';
import type { QueuedResponse } from '../core/dto/queued.response';

const LANGUAGE_ORDER: string[] = MOSS_LANGUAGES.map(([name]) => name);

@Injectable()
export class ContestMossService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly contestsService: ContestsService,
    private readonly mossRows: ContestMossRepository,
    private readonly problems: ProblemsRepository,
    @InjectQueue(CONTEST_MOSS_QUEUE)
    private readonly queue: Queue<ContestMossJob>,
  ) {}

  async results(
    principal: Principal,
    key: string,
  ): Promise<ContestMossResponse> {
    const contest = await this.mossContest(principal, key);
    const ordered = [...contest.problems]
      .sort((left, right) => left.order - right.order)
      .map((entry) => uuidStr(entry.problem));
    const codes = new Map(
      (await this.problems.findSummaries(ordered)).map((problem) => [
        problem._id,
        problem.code,
      ]),
    );
    const rows = (await this.mossRows.findByContest(contest._id))
      .filter((row) => ordered.includes(row.problemId))
      .sort(
        (left, right) =>
          ordered.indexOf(left.problemId) - ordered.indexOf(right.problemId) ||
          LANGUAGE_ORDER.indexOf(left.language) -
            LANGUAGE_ORDER.indexOf(right.language),
      );
    return {
      running: (await this.queue.getJob(mossJobId(contest._id))) !== undefined,
      results: rows.map((row) => ({
        ...row,
        code: codes.get(row.problemId) ?? '',
        label: problemLabel(ordered.indexOf(row.problemId), contest.labelStyle),
      })),
    };
  }

  async run(principal: Principal, key: string): Promise<QueuedResponse> {
    const contest = await this.mossContest(principal, key);
    if (await this.queue.getJob(mossJobId(contest._id)))
      throw new AppError(
        'conflict',
        409,
        'MOSS is already running for this contest',
      );
    await this.queue.add(
      CONTEST_MOSS_JOB,
      { contestId: contest._id },
      oneJobPerContest('moss', contest._id),
    );
    return { queued: true };
  }

  async clear(principal: Principal, key: string): Promise<void> {
    const contest = await this.mossContest(principal, key);
    await this.mossRows.deleteByContest(contest._id);
  }

  /** Legacy `ContestMossMixin`: off without a key (404), then edit rights and `judge.moss_contest` (403). */
  private async mossContest(principal: Principal, key: string) {
    if (!this.env.mossApiKey)
      throw new AppError('not_found', 404, 'MOSS is not configured');
    const contest = await this.contestsService.editableContest(principal, key);
    if (!hasPermission(principal, 'judge.moss_contest'))
      throw new AppError('forbidden', 403, 'MOSS needs judge.moss_contest');
    return contest;
  }
}
