import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { toUuid, uuidStr } from '@libs/database';
import { BSON, Document } from 'mongodb';
import { Connection } from 'mongoose';
import { IdMap } from './id-map';
import { LegacySource } from './legacy-source';
import { batched, MapCtx, MappedDocument, Mapper, MAPPERS } from './mapper';

const sortKeys = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(sortKeys)
    : value && typeof value === 'object' && value.constructor === Object
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, sortKeys((value as Document)[key])]),
        )
      : value;

@Injectable()
export class MigrationService {
  private readonly logger = new Logger(MigrationService.name);

  constructor(
    @Inject(MAPPERS) private readonly mappers: Mapper[],
    @InjectConnection() private readonly conn: Connection,
    private readonly source: LegacySource,
    private readonly ids: IdMap,
  ) {}

  /** Re-runnable: upserts by _id, so only new or changed legacy rows are written. `fresh` empties each job's collection first. */
  async backfill(jobs?: string[], fresh = false) {
    const selected = this.select(jobs);
    await this.ids.build();
    await this.conn.syncIndexes();
    for (const mapper of selected) {
      const ctx = await this.prepare(mapper);
      const collection = this.conn.collection<MappedDocument>(
        mapper.collection,
      );
      if (fresh) await collection.deleteMany({});
      for await (const rows of batched(this.source.stream(mapper.sql), 1000))
        await collection.bulkWrite(
          rows.map((row) => {
            const doc = mapper.map(row, ctx);
            return {
              replaceOne: {
                filter: { _id: doc._id },
                replacement: doc,
                upsert: true,
              },
            };
          }),
        );
      this.logger.log(
        `${mapper.name}: ${await collection.countDocuments()} documents`,
      );
    }
  }

  async verify(jobs?: string[]): Promise<number> {
    const selected = this.select(jobs);
    let bad = 0;
    const report = (message: string) => {
      if (bad++ < 20) this.logger.error(message);
    };
    for (const mapper of selected) {
      const ctx = await this.prepare(mapper);
      const collection = this.conn.collection<MappedDocument>(
        mapper.collection,
      );
      const canonical = (doc: MappedDocument) =>
        BSON.EJSON.stringify(
          sortKeys(mapper.normalize ? mapper.normalize(doc) : doc),
          { relaxed: false },
        );
      let total = 0;
      for await (const rows of batched(this.source.stream(mapper.sql), 1000)) {
        const expected = rows.map((row) => mapper.map(row, ctx));
        const actual = new Map(
          (
            await collection
              .find({ _id: { $in: expected.map((doc) => doc._id) } })
              .toArray()
          ).map((doc) => [uuidStr(doc._id), doc] as const),
        );
        total += rows.length;
        for (const doc of expected) {
          const found = actual.get(uuidStr(doc._id));
          if (!found || canonical(found) !== canonical(doc))
            report(`${mapper.name}: mismatch ${uuidStr(doc._id)}`);
        }
      }
      const count = await collection.countDocuments();
      if (count !== total)
        report(`${mapper.name}: ${count} documents, ${total} source rows`);
    }
    return bad;
  }

  private select(jobs: string[] = []): Mapper[] {
    for (const name of jobs)
      if (!this.mappers.some((mapper) => mapper.name === name))
        throw new Error(`unknown job: ${name}`);
    return jobs.length
      ? this.mappers.filter((mapper) => jobs.includes(mapper.name))
      : this.mappers;
  }

  private async prepare(mapper: Mapper): Promise<MapCtx> {
    await this.ids.load(mapper.refTables);
    await mapper.prepare?.(this.source);
    const ref = (table: string, id: number | null) =>
      id == null ? null : toUuid(this.ids.get(table, id));
    return {
      ref,
      refs: (table, ids) => ids.map((id) => ref(table, id)!),
      date: (value) =>
        value instanceof Date && !isNaN(value.getTime()) ? value : null,
      bool: (value) => Boolean(Number(value)),
      json: (value) =>
        typeof value === 'string' ? (JSON.parse(value) as unknown) : value,
    };
  }
}
