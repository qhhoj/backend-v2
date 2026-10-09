import { createReadStream } from 'node:fs';
import type { ReadStream } from 'node:fs';
import { once } from 'node:events';
import { stat } from 'node:fs/promises';
import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { Principal } from '@libs/auth';
import { ENV } from '@libs/common';
import type { Env } from '@libs/common';
import {
  canPrepareData,
  CONTEST_DATA_PREPARE_INTERVAL_MS,
  CONTEST_EXPORT_JOB,
  CONTEST_EXPORT_QUEUE,
  contestExportJobId,
  contestExportPath,
  contestPhase,
  oneJobPerContest,
} from '@libs/contests';
import type { ContestExportJob } from '@libs/contests';
import { ContestViewerService } from '../core/contest-viewer.service';
import { ContestsRepository } from '../core/contests.repository';
import type { ContestDocument } from '../core/contests.repository';
import type { QueuedResponse } from '../core/dto/queued.response';
import type { ContestExportStatusResponse } from './dto/contest-export.dto';
import { refusalsOf } from '../core/coded-refusal';

const exportRefusal = refusalsOf('export');

/** Split out of `status` to keep its complexity under the gate. */
const stateOf = (
  isPreparing: boolean,
  hasZip: boolean,
): ContestExportStatusResponse['state'] => {
  if (isPreparing) return 'preparing';
  return hasZip ? 'ready' : 'none';
};

@Injectable()
export class ContestExportService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly viewers: ContestViewerService,
    private readonly contests: ContestsRepository,
    @InjectQueue(CONTEST_EXPORT_QUEUE)
    private readonly queue: Queue<ContestExportJob>,
  ) {}

  async status(
    principal: Principal,
    key: string,
    now = new Date(),
  ): Promise<ContestExportStatusResponse> {
    const { contest, root } = await this.exportContest(principal, key, now);
    const file = await stat(contestExportPath(root, contest._id)).catch(
      () => null,
    );
    const isPreparing = await this.isPreparing(contest._id);
    const preparedAt = contest.exportPreparedAt;
    return {
      state: stateOf(isPreparing, file !== null),
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

  async request(
    principal: Principal,
    key: string,
    now = new Date(),
  ): Promise<QueuedResponse> {
    const { contest, root } = await this.exportContest(principal, key, now);
    if (await this.isPreparing(contest._id))
      throw exportRefusal(
        409,
        'conflict',
        'export_in_progress',
        'The export is being prepared',
      );
    const hasZip = await stat(contestExportPath(root, contest._id)).then(
      () => true,
      () => false,
    );
    if (!canPrepareData(contest.exportPreparedAt, hasZip, now))
      throw exportRefusal(
        429,
        'rate_limited',
        'export_rate_limited',
        'The export can be prepared once a day',
      );
    await this.contests.setExportPreparedAt(contest._id, now);
    await this.queue.add(
      CONTEST_EXPORT_JOB,
      { contestId: contest._id },
      oneJobPerContest('export', contest._id),
    );
    return { queued: true };
  }

  /** Opened here, so a zip that vanishes (a prepare starting) is a 404, never a failed response. */
  async download(
    principal: Principal,
    key: string,
    now = new Date(),
  ): Promise<{ stream: ReadStream; filename: string }> {
    const { contest, root } = await this.exportContest(principal, key, now);
    const stream = createReadStream(contestExportPath(root, contest._id));
    try {
      await once(stream, 'open');
    } catch {
      stream.destroy();
      throw exportRefusal(
        404,
        'not_found',
        'export_not_prepared',
        'No export has been prepared',
      );
    }
    return { stream, filename: `${contest.key}-export.zip` };
  }

  private async isPreparing(contestId: string): Promise<boolean> {
    return (
      (await this.queue.getJob(contestExportJobId(contestId))) !== undefined
    );
  }

  /** Same rule as the data download: off without a root (404), editors only (403), ended only (409). */
  private async exportContest(
    principal: Principal,
    key: string,
    now: Date,
  ): Promise<{ contest: ContestDocument; root: string }> {
    const root = this.env.contestDataRoot;
    if (!root)
      throw exportRefusal(
        404,
        'not_found',
        'export_not_configured',
        'Contest export is not configured',
      );
    const contest = await this.viewers.editableContest(principal, key);
    if (contestPhase(contest, now) !== 'ended')
      throw exportRefusal(
        409,
        'conflict',
        'contest_not_ended',
        'Wait until the contest has ended',
      );
    return { contest, root };
  }
}
