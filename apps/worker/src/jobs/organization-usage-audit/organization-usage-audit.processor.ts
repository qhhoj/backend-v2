import {
  InjectQueue,
  OnWorkerEvent,
  Processor,
  WorkerHost,
} from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  ORGANIZATION_USAGE_AUDIT_JOB,
  ORGANIZATION_USAGE_AUDIT_PATTERN,
  ORGANIZATION_USAGE_AUDIT_QUEUE,
  ORGANIZATION_USAGE_AUDIT_SCHEDULER,
} from '@libs/community';
import { OrganizationUsageAuditService } from './organization-usage-audit.service';

@Processor(ORGANIZATION_USAGE_AUDIT_QUEUE, { concurrency: 1 })
export class OrganizationUsageAuditProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(OrganizationUsageAuditProcessor.name);

  constructor(
    private readonly audits: OrganizationUsageAuditService,
    @InjectQueue(ORGANIZATION_USAGE_AUDIT_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  /** One schedule for every worker process (the upsert is idempotent), so two replicas never double the run. */
  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      ORGANIZATION_USAGE_AUDIT_SCHEDULER,
      { pattern: ORGANIZATION_USAGE_AUDIT_PATTERN },
      {
        name: ORGANIZATION_USAGE_AUDIT_JOB,
        opts: { removeOnComplete: true, removeOnFail: 20 },
      },
    );
  }

  process(): Promise<{ checked: number; drifted: number }> {
    return this.audits.audit();
  }

  @OnWorkerEvent('error')
  onError(error: Error): void {
    this.logger.error(`Usage audit worker error: ${error.message}`);
  }

  @OnWorkerEvent('failed')
  onFailed(_job: unknown, error: Error): void {
    this.logger.error(`Usage audit failed: ${error.message}`);
  }
}
