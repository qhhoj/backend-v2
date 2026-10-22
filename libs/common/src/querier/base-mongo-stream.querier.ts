import { Logger } from '@nestjs/common';
import { CronExpression, SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import {
  ChangeStreamDocument,
  ChangeStreamInsertDocument,
  ChangeStreamReplaceDocument,
  ChangeStreamUpdateDocument,
  Timestamp,
} from 'mongodb';
import { SNAPSHOT_LOAD_COMMENT } from '@libs/database';
import { Model } from 'mongoose';
import { randomUUID } from 'node:crypto';

export type QuerierChange =
  | ChangeStreamInsertDocument
  | ChangeStreamUpdateDocument
  | ChangeStreamReplaceDocument;

export interface StreamHandlers {
  onChange: (change: QuerierChange) => Promise<void>;
  resync: () => Promise<void>;
  onDelete?: (id: unknown) => void;
}

/** In-memory read model for small, simple, frequently read data. Deletes reach `onDelete` only when the subclass passes one; without it a deleted row lingers until the next resync. */
export abstract class BaseMongoStreamQuerier {
  private readonly streamLogger = new Logger(BaseMongoStreamQuerier.name);
  /** One list per snapshot load in flight: the stream events handled since that load began. */
  private readonly loadsInFlight = new Set<Array<() => void>>();

  constructor(private readonly scheduler: SchedulerRegistry) {}

  streamHealthCheckCronExpression() {
    return CronExpression.EVERY_10_SECONDS;
  }

  /**
   * Loads the snapshot with `resync` and follows changes from the moment before that load, so no change can fall
   * into a gap (a change the snapshot already holds is applied again, which is harmless: handlers are upserts).
   * A closed stream is replaced and resynced the same way.
   */
  async setupMongoStream(
    model: Model<any>,
    pipeline: Record<string, unknown>[],
    handlers: StreamHandlers,
  ) {
    if (process.env.DISABLE_MONGODB_STREAM === 'true') return handlers.resync();
    const syncAndWatch = async () => {
      const stream = this.getModelStream(
        model,
        pipeline,
        handlers,
        await this.clusterTime(model),
      );
      await handlers.resync().catch((error: Error) => {
        stream.close().catch(() => {});
        throw error;
      });
      return stream;
    };
    let stream = await syncAndWatch();
    let reconnecting = false;
    this.addJob(
      'mongo-stream-healthcheck',
      this.streamHealthCheckCronExpression(),
      () => {
        if (!stream.closed || reconnecting) return;
        this.streamLogger.log(
          `MongoDB stream closed, reconnecting (${model.modelName})`,
        );
        reconnecting = true;
        stream.removeAllListeners();
        syncAndWatch()
          .then((reopened) => (stream = reopened))
          .catch((error: Error) =>
            this.streamLogger.warn(
              `MongoDB stream reconnect failed (${model.modelName}): ${error.message}`,
            ),
          )
          .finally(() => (reconnecting = false));
      },
    );
  }

  /** The server's current operation time: a stream started at it misses no write acknowledged before this call. */
  private async clusterTime(model: Model<any>) {
    const { operationTime } = await model.db.db!.command({ ping: 1 });
    return operationTime as Timestamp;
  }

  private getModelStream(
    model: Model<any>,
    pipeline: Record<string, unknown>[],
    handlers: Pick<StreamHandlers, 'onChange' | 'onDelete'>,
    startAtOperationTime: Timestamp,
  ) {
    const stream = model.watch(pipeline, {
      fullDocument: 'updateLookup',
      startAtOperationTime,
    });
    stream.on('change', (change: ChangeStreamDocument) => {
      if (change.operationType === 'delete')
        return this.apply(() => handlers.onDelete?.(change.documentKey._id));
      if (!['insert', 'update', 'replace'].includes(change.operationType))
        return;
      this.apply(
        () =>
          void handlers
            .onChange(change as QuerierChange)
            .catch((error: Error) =>
              this.streamLogger.warn(
                `Querier change handler failed (${model.modelName}): ${error.message}`,
              ),
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

  /** Applies a stream event now, and records it for every load in flight to apply again after its swap. */
  private apply(event: () => void) {
    event();
    for (const events of this.loadsInFlight) events.push(event);
  }

  /**
   * Loads a fresh state and installs it, then re-applies the stream events handled during the load: they went to
   * the state being replaced, and the snapshot may predate them. Every resync swaps its state through here.
   */
  protected async replaceState<State>(
    load: () => Promise<State>,
    install: (state: State) => void,
  ) {
    const events: Array<() => void> = [];
    this.loadsInFlight.add(events);
    try {
      install(await load());
    } finally {
      this.loadsInFlight.delete(events);
    }
    events.forEach((event) => event());
  }

  /** Every row of a small collection, tagged so index profiling excuses this intended scan. */
  protected loadAll<Doc>(model: Model<Doc>): Promise<Doc[]> {
    return model.find().comment(SNAPSHOT_LOAD_COMMENT).lean<Doc[]>().exec();
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
