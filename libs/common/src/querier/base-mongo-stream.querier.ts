import { Logger } from '@nestjs/common';
import { CronExpression, SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import {
  ChangeStreamDocument,
  ChangeStreamInsertDocument,
  ChangeStreamReplaceDocument,
  ChangeStreamUpdateDocument,
} from 'mongodb';
import { Model } from 'mongoose';
import { randomUUID } from 'node:crypto';

export type QuerierChange =
  | ChangeStreamInsertDocument
  | ChangeStreamUpdateDocument
  | ChangeStreamReplaceDocument;

/** In-memory read model for small, simple, frequently read data that is never deleted. */
export abstract class BaseMongoStreamQuerier {
  private readonly streamLogger = new Logger(BaseMongoStreamQuerier.name);

  constructor(private readonly scheduler: SchedulerRegistry) {}

  streamHealthCheckCronExpression() {
    return CronExpression.EVERY_10_SECONDS;
  }

  setupMongoStream(
    model: Model<any>,
    pipeline: Record<string, unknown>[],
    onChange: (change: QuerierChange) => Promise<void>,
  ) {
    if (process.env.DISABLE_MONGODB_STREAM === 'true') return;
    let stream = this.getModelStream(model, pipeline, onChange);
    const reconnect = () => {
      stream.removeAllListeners();
      stream.close().catch(() => {});
      stream = this.getModelStream(model, pipeline, onChange);
    };
    this.addJob(
      'mongo-stream-healthcheck',
      this.streamHealthCheckCronExpression(),
      () => {
        if (stream.closed) {
          this.streamLogger.log(
            `MongoDB stream closed, reconnecting (${model.modelName})`,
          );
          reconnect();
        }
      },
    );
  }

  getModelStream(
    model: Model<any>,
    pipeline: Record<string, unknown>[],
    onChange: (change: QuerierChange) => Promise<void>,
  ) {
    const stream = model.watch(pipeline, { fullDocument: 'updateLookup' });
    stream.on('change', (change: ChangeStreamDocument) => {
      if (!['insert', 'update', 'replace'].includes(change.operationType))
        return;
      onChange(change as QuerierChange).catch((error: Error) =>
        this.streamLogger.warn(
          `Querier change handler failed (${model.modelName}): ${error.message}`,
        ),
      );
    });
    stream.on('error', (err: Error) => {
      this.streamLogger.warn(
        `MongoDB stream error, closing for reconnect (${model.modelName}): ${err.message}`,
      );
      stream.close().catch(() => {});
    });
    return stream;
  }

  forceResyncQuerier(resync: () => Promise<void>, cron: string) {
    this.addJob(
      'force-resync-querier',
      cron,
      () =>
        void resync().catch((err: Error) =>
          this.streamLogger.warn(`forceResyncQuerier failed: ${err.message}`),
        ),
    );
  }

  private addJob(prefix: string, cron: string, tick: () => void) {
    const job = new CronJob(cron, tick);
    this.scheduler.addCronJob(`${prefix}-${randomUUID()}`, job);
    job.start();
  }
}
