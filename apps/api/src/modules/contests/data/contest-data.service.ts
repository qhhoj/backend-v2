import { createReadStream } from 'node:fs';
import type { ReadStream } from 'node:fs';
import { once } from 'node:events';
import { stat } from 'node:fs/promises';
import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { Principal } from '@libs/auth';
import { AppError, ENV } from '@libs/common';
import type { Env } from '@libs/common';
import {
  canPrepareData,
  CONTEST_DATA_JOB,
  CONTEST_DATA_PREPARE_INTERVAL_MS,
  CONTEST_DATA_QUEUE,
  contestDataJobId,
  contestDataPath,
  contestPhase,
  oneJobPerContest,
} from '@libs/contests';
import type { ContestDataJob } from '@libs/contests';
import { ContestsRepository } from '../core/contests.repository';
import { ContestsService } from '../core/contests.service';
import type {
  ContestDataStatusResponse,
  PrepareDataDto,
} from './dto/contest-data.dto';
import type { QueuedResponse } from '../core/dto/queued.response';

@Injectable()
export class ContestDataService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly contestsService: ContestsService,
    private readonly contests: ContestsRepository,
    @InjectQueue(CONTEST_DATA_QUEUE)
    private readonly queue: Queue<ContestDataJob>,
  ) {}

  async status(
    principal: Principal,
    key: string,
    now = new Date(),
  ): Promise<ContestDataStatusResponse> {
    const { contest, root } = await this.dataContest(principal, key, now);
    const file = await stat(contestDataPath(root, contest._id)).catch(
      () => null,
    );
    const preparing =
      (await this.queue.getJob(contestDataJobId(contest._id))) !== undefined;
    const preparedAt = contest.dataPreparedAt;
    return {
      state: preparing ? 'preparing' : file ? 'ready' : 'none',
      preparedAt: preparedAt?.toISOString() ?? null,
      readyAt: file?.mtime.toISOString() ?? null,
      size: file?.size ?? null,
      nextPrepareAt: canPrepareData(preparedAt, file !== null, now)
        ? null
        : new Date(
            preparedAt!.getTime() + CONTEST_DATA_PREPARE_INTERVAL_MS,
          ).toISOString(),
    };
  }

  async prepare(
    principal: Principal,
    key: string,
    dto: PrepareDataDto,
    now = new Date(),
  ): Promise<QueuedResponse> {
    const { contest, root } = await this.dataContest(principal, key, now);
    if (await this.queue.getJob(contestDataJobId(contest._id)))
      throw new AppError('conflict', 409, 'The data is being prepared');
    const zipExists = await stat(contestDataPath(root, contest._id)).then(
      () => true,
      () => false,
    );
    if (!canPrepareData(contest.dataPreparedAt, zipExists, now))
      throw new AppError(
        'rate_limited',
        429,
        'The data can be prepared once a day',
      );
    await this.contests.setDataPreparedAt(contest._id, now);
    await this.queue.add(
      CONTEST_DATA_JOB,
      {
        contestId: contest._id,
        problemGlob: dto.problemGlob ?? '*',
        results: dto.results ?? [],
      },
      oneJobPerContest('data', contest._id),
    );
    return { queued: true };
  }

  /** Opened here, so a zip that vanishes (a prepare starting) is a 404, never a failed response. */
  async download(
    principal: Principal,
    key: string,
    now = new Date(),
  ): Promise<{ stream: ReadStream; filename: string }> {
    const { contest, root } = await this.dataContest(principal, key, now);
    const stream = createReadStream(contestDataPath(root, contest._id));
    try {
      await once(stream, 'open');
    } catch {
      stream.destroy();
      throw new AppError('not_found', 404, 'No data has been prepared');
    }
    return { stream, filename: `${contest.key}-data.zip` };
  }

  /** Legacy `ContestDataMixin`: off without a root (404), editors only (403), ended only (409). */
  private async dataContest(principal: Principal, key: string, now: Date) {
    const root = this.env.contestDataRoot;
    if (!root)
      throw new AppError(
        'not_found',
        404,
        'Contest data download is not configured',
      );
    const contest = await this.contestsService.editableContest(principal, key);
    if (contestPhase(contest, now) !== 'ended')
      throw new AppError('conflict', 409, 'Wait until the contest has ended');
    return { contest, root };
  }
}
