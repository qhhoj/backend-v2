import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { uuidStr } from '@libs/database';
import { BSON, Collection, Document, MongoBulkWriteError } from 'mongodb';
import { Connection } from 'mongoose';
import { ChildCursor } from './child-cursor';
import { IdMapRepository } from './id-map.repository';
import { LegacySourceService } from './legacy-source.service';
import { createMapCtx } from './map-ctx';
import { batched, MapCtx, MappedDocument, Mapper, MAPPERS } from './mapper';
import { MigrationReport } from './migration-report';
import { schemaErrors } from './schema-check';
import { skippedLines } from './skipped-tables';

const DUPLICATE_KEY = 11000;
const MISSING_ID = /^no uuid for \S+$/;

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

const isDocument = (doc: MappedDocument | null): doc is MappedDocument =>
  doc !== null;

@Injectable()
export class MigrationService {
  private readonly logger = new Logger(MigrationService.name);
  /** Source rows per bulk write; tests lower it to cross batch boundaries. */
  batchSize = 1000;

  constructor(
    @Inject(MAPPERS) private readonly mappers: Mapper[],
    @InjectConnection() private readonly conn: Connection,
    private readonly source: LegacySourceService,
    private readonly ids: IdMapRepository,
  ) {}

  /** Re-runnable: upserts by _id. `fresh` empties each job's collection first. Returns each job's report lines. */
  async backfill(
    jobs?: string[],
    fresh = false,
  ): Promise<Record<string, string[]>> {
    const selected = this.select(jobs);
    await this.ids.build([
      ...new Set(this.mappers.flatMap((mapper) => mapper.refTables)),
    ]);
    await this.conn.syncIndexes();
    const reports: Record<string, string[]> = {};
    for (const mapper of selected)
      reports[mapper.name] = await this.backfillJob(mapper, fresh);
    return reports;
  }

  async verify(jobs?: string[]): Promise<number> {
    let bad = 0;
    const fail = (message: string) => {
      if (bad++ < 20) this.logger.error(message);
    };
    for (const line of skippedLines()) this.logger.log(line);
    for (const mapper of this.select(jobs)) await this.verifyJob(mapper, fail);
    return bad;
  }

  private async backfillJob(mapper: Mapper, fresh: boolean): Promise<string[]> {
    const report = new MigrationReport();
    const collection = this.conn.collection<MappedDocument>(mapper.collection);
    if (fresh) await collection.deleteMany({});
    for await (const docs of this.mapped(mapper, report))
      if (docs.length) await this.write(collection, docs, report);
    report.flush(mapper.name, this.logger);
    this.logger.log(
      `${mapper.name}: ${await collection.countDocuments()} documents`,
    );
    return report.lines();
  }

  /** Unordered upserts: a row a v2 unique index refuses is reported by uuid and the rest of the batch still lands. The driver's message quotes the key value (a username, a slug), so it is never logged. */
  private async write(
    collection: Collection<MappedDocument>,
    docs: MappedDocument[],
    report: MigrationReport,
  ): Promise<void> {
    try {
      await collection.bulkWrite(
        docs.map((doc) => ({
          replaceOne: {
            filter: { _id: doc._id },
            replacement: doc,
            upsert: true,
          },
        })),
        { ordered: false },
      );
    } catch (error) {
      if (!(error instanceof MongoBulkWriteError)) throw error;
      const refused = [error.writeErrors].flat();
      const codes = [...new Set(refused.map((writeError) => writeError.code))];
      if (!refused.length || codes.some((code) => code !== DUPLICATE_KEY))
        throw new Error(
          `${collection.collectionName}: bulk write failed (codes ${codes.join(', ') || 'none'})`,
        );
      for (const writeError of refused)
        report.add(
          `duplicate key ${collection.collectionName} ${uuidStr(docs[writeError.index]._id)}`,
        );
    }
  }

  /** A legacy row added since the last `backfill` has no id yet: counted as a mismatch, never a crash (always `backfill` before `verify`). */
  private async verifyJob(mapper: Mapper, fail: (message: string) => void) {
    try {
      await this.compareJob(mapper, fail);
    } catch (error) {
      const message = (error as Error).message;
      if (!MISSING_ID.test(message)) throw error;
      fail(
        `${mapper.name}: missing id (${message.slice('no uuid for '.length)}); run backfill first`,
      );
    }
  }

  private async compareJob(mapper: Mapper, fail: (message: string) => void) {
    const collection = this.conn.collection<MappedDocument>(mapper.collection);
    const canonical = (doc: MappedDocument) =>
      BSON.EJSON.stringify(
        sortKeys(mapper.normalize ? mapper.normalize(doc) : doc),
        { relaxed: false },
      );
    let total = 0;
    for await (const expected of this.mapped(mapper, new MigrationReport())) {
      total += expected.length;
      const actual = new Map(
        (
          await collection
            .find({ _id: { $in: expected.map((doc) => doc._id) } })
            .toArray()
        ).map((doc) => [uuidStr(doc._id), doc] as const),
      );
      for (const doc of expected) {
        const found = actual.get(uuidStr(doc._id));
        if (!found || canonical(found) !== canonical(doc))
          fail(`${mapper.name}: mismatch ${uuidStr(doc._id)}`);
        for (const error of schemaErrors(this.conn, mapper.collection, doc))
          fail(`${mapper.name}: ${uuidStr(doc._id)} ${error}`);
      }
    }
    const count = await collection.countDocuments();
    if (count !== total)
      fail(`${mapper.name}: ${count} documents, ${total} mapped rows`);
  }

  /** Mapped documents per source batch; children are merge-joined on the parent's `id`. */
  private async *mapped(
    mapper: Mapper,
    report: MigrationReport,
  ): AsyncGenerator<MappedDocument[]> {
    await this.ids.load(mapper.refTables);
    await mapper.prepare?.(this.source);
    const ctx = createMapCtx(this.ids, report);
    const children = mapper.children
      ? new ChildCursor(
          this.source.stream<Document>(mapper.children.sql),
          mapper.children.key,
        )
      : null;
    try {
      yield* this.mappedBatches(mapper, ctx, report, children);
      const leftover = await children?.drain();
      if (leftover)
        report.add(`${leftover} child row(s) after the last parent`);
    } finally {
      await children?.close();
    }
  }

  private async *mappedBatches(
    mapper: Mapper,
    ctx: MapCtx,
    report: MigrationReport,
    children: ChildCursor<Document> | null,
  ): AsyncGenerator<MappedDocument[]> {
    for await (const rows of batched(
      this.source.stream<{ id: number }>(mapper.sql),
      this.batchSize,
    )) {
      const grouped = await children?.takeThrough(Number(rows.at(-1)!.id));
      yield rows
        .map((row) => {
          const own = grouped?.get(Number(row.id)) ?? [];
          grouped?.delete(Number(row.id));
          return mapper.map(row, ctx, own);
        })
        .filter(isDocument);
      for (const key of grouped?.keys() ?? [])
        report.add(`${mapper.name}: child rows of missing parent ${key}`);
    }
  }

  private select(jobs: string[] = []): Mapper[] {
    for (const name of jobs)
      if (!this.mappers.some((mapper) => mapper.name === name))
        throw new Error(`unknown job: ${name}`);
    return jobs.length
      ? this.mappers.filter((mapper) => jobs.includes(mapper.name))
      : this.mappers;
  }
}
