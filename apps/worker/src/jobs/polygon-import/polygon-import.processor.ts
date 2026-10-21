import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import type { Job } from 'bullmq';
import { AUTO_RETRIED_IMPORT_ERRORS, POLYGON_QUEUE } from '@libs/problems';
import type {
  ImportProgress,
  PolygonImportJob,
  PolygonImportResult,
} from '@libs/problems';
import type { PolygonSyncStep } from '@libs/database';
import { DiscordWebhooksService } from '@libs/community';
import { importFailureOf } from './import-failure';
import type { ImportFailure } from './import-failure';
import { ImportQuota } from './import-quota.service';
import { ImportTracker } from './import-tracker';
import { PolygonImportRepository } from './polygon-import.repository';
import { PolygonImportService } from './polygon-import.service';
import { PolygonSyncRunsRepository } from './polygon-sync-runs.repository';

@Processor(POLYGON_QUEUE, { concurrency: 1 })
export class PolygonImportProcessor extends WorkerHost {
  private readonly logger = new Logger(PolygonImportProcessor.name);

  constructor(
    private readonly imports: PolygonImportService,
    private readonly repository: PolygonImportRepository,
    private readonly runs: PolygonSyncRunsRepository,
    private readonly quota: ImportQuota,
    private readonly discord: DiscordWebhooksService,
  ) {
    super();
  }

  /** Every Polygon job is recorded in the sync history; a failure also stores its step and code on the job and, for a sync, on the problem's link, and gives back the credits of a create. A created organization problem is announced like one made on the site. */
  async process(job: Job<PolygonImportJob>): Promise<PolygonImportResult> {
    const tracker = new ImportTracker((progress) => this.report(job, progress));
    try {
      if (!job.id) throw new Error('A queued job always has an id');
      const result = await this.imports.import(job.id, job.data, tracker);
      await this.recordSuccess(job, result);
      return result;
    } catch (error) {
      throw await this.failed(job, tracker.step, error);
    }
  }

  /** An import that committed but needs a repair (`attention`) completes, and is recorded like a failed sync so the link shows it. */
  private async recordSuccess(
    job: Job<PolygonImportJob>,
    result: PolygonImportResult,
  ): Promise<void> {
    if (result.attention) {
      const { code, params, message } = result.attention;
      await this.recordFailure(job, 'finishing', {
        code,
        params,
        message,
        reason: message,
      });
    } else
      await this.bestEffort('Sync run', () =>
        this.runs.record(job.id ?? '', job.data, {
          result: 'ok',
          problemId: result.problemId,
        }),
      );
    if (job.data.mode === 'create' && job.data.organizationId)
      await this.bestEffort('Announcement', () =>
        this.announce(job.data, result.problemId),
      );
  }

  /** The error BullMQ records: an outage the job may outlast is retried once later with nothing recorded yet; anything else is final (`UnrecoverableError`) and recorded. */
  private async failed(
    job: Job<PolygonImportJob>,
    step: PolygonSyncStep,
    error: unknown,
  ): Promise<Error> {
    const failure = importFailureOf(error);
    if (failure.code === 'import_failed')
      this.logger.error(
        `Polygon import of ${job.data.code} failed`,
        error instanceof Error ? error.stack : String(error),
      );
    if (retriesLater(job, failure)) return new Error(failure.reason);
    await this.recordFailure(job, step, failure);
    return new UnrecoverableError(failure.reason);
  }

  /** Recording never masks the import's own error. */
  private async recordFailure(
    job: Job<PolygonImportJob>,
    step: PolygonSyncStep,
    failure: ImportFailure,
  ): Promise<void> {
    await this.bestEffort('Failed step', () =>
      job.updateData({
        ...job.data,
        failedStep: step,
        errorCode: failure.code,
        errorParams: failure.params,
      }),
    );
    await this.bestEffort('Credit refund', () =>
      this.quota.refundFailed(job.id ?? '', job.data, step),
    );
    await this.bestEffort('Sync failure', () =>
      this.repository.recordSyncFailure(job.data, failure),
    );
    await this.bestEffort('Sync run', () =>
      this.runs.record(job.id ?? '', job.data, {
        result: 'failed',
        step,
        failure,
      }),
    );
  }

  private async announce(
    job: PolygonImportJob,
    problemId: string,
  ): Promise<void> {
    const announcement = await this.repository.announcementOf(
      problemId,
      job.requesterId,
    );
    if (announcement)
      await this.discord.announceNewProblem(
        announcement.problem,
        'create',
        announcement.username,
      );
  }

  private async bestEffort(
    what: string,
    write: () => Promise<void>,
  ): Promise<void> {
    try {
      await write();
    } catch (error) {
      this.logger.warn(`${what} not recorded: ${(error as Error).message}`);
    }
  }

  /** Progress is for the status page only; losing an update never fails the import. */
  private async report(
    job: Job<PolygonImportJob>,
    progress: ImportProgress,
  ): Promise<void> {
    try {
      await job.updateProgress(progress);
    } catch (error) {
      this.logger.warn(
        `Import progress not saved: ${(error as Error).message}`,
      );
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<PolygonImportJob> | undefined, error: Error): void {
    this.logger.error(
      `Polygon import of ${job?.data.code} failed: ${error.message}`,
    );
  }
}

/** BullMQ runs the job again (after its backoff) when attempts are left and the failure is an outage that may pass. */
const retriesLater = (
  job: Job<PolygonImportJob>,
  failure: ImportFailure,
): boolean =>
  AUTO_RETRIED_IMPORT_ERRORS.has(failure.code) &&
  job.attemptsMade + 1 < (job.opts?.attempts ?? 1);
