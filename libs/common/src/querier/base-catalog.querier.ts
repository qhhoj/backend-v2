import { OnModuleInit } from '@nestjs/common';
import { CronExpression, SchedulerRegistry } from '@nestjs/schedule';
import { uuidStr } from '@libs/database';
import { Model } from 'mongoose';
import { BaseMongoStreamQuerier } from './base-mongo-stream.querier';

/** Querier for a whole small collection: every document in memory, keyed by its id string (ids normalised from BSON UUID). */
export abstract class BaseCatalogQuerier<Item extends { _id: string }>
  extends BaseMongoStreamQuerier
  implements OnModuleInit
{
  private items = new Map<string, Item>();

  protected constructor(
    private readonly model: Model<Item>,
    scheduler: SchedulerRegistry,
  ) {
    super(scheduler);
  }

  async onModuleInit() {
    await this.setupMongoStream(this.model, [], {
      // eslint-disable-next-line @typescript-eslint/require-await
      onChange: async ({ fullDocument }) =>
        void (
          fullDocument &&
          this.items.set(
            uuidStr(fullDocument._id),
            this.toItem(fullDocument as object & { _id: unknown }),
          )
        ),
      resync: () => this.resync(),
      onDelete: (id) => void this.items.delete(uuidStr(id)),
    });
    this.forceResyncQuerier(
      () => this.resync(),
      CronExpression.EVERY_10_MINUTES,
    );
  }

  async resync() {
    await this.replaceState(
      () => this.loadAll(this.model),
      (docs) =>
        (this.items = new Map(
          docs.map((doc) => [uuidStr(doc._id), this.toItem(doc)]),
        )),
    );
  }

  all(): Item[] {
    return [...this.items.values()];
  }

  byId(id: string): Item | null {
    return this.items.get(id) ?? null;
  }

  /** Unknown ids are skipped; order follows `ids`. */
  byIds(ids: string[]): Item[] {
    return ids.flatMap((id) => this.items.get(id) ?? []);
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  private toItem(doc: object & { _id: unknown }): Item {
    return { ...doc, _id: uuidStr(doc._id) } as Item;
  }
}
