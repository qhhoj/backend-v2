import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { newId } from '@libs/database';
import { Connection } from 'mongoose';
import { v7 } from 'uuid';
import { LegacySourceService } from './legacy-source.service';
import { batched } from './mapper';

/** Tables whose rows reuse another table's uuid: sql yields {id, target}. */
const ALIASES: Record<string, { sql: string; target: string }> = {
  judge_profile: {
    sql: 'SELECT id, user_id AS target FROM judge_profile ORDER BY id',
    target: 'auth_user',
  },
};

/** Tables whose uuids carry the legacy creation time, so `-_id` lists stay in time order (decisions.md: ticket ids are stamped). */
export const TIMED_TABLES: Record<string, string> = {
  judge_submission: 'date',
  judge_comment: 'time',
  judge_blogpost: 'publish_on',
  judge_ticket: 'time',
  judge_ticketmessage: 'time',
  judge_contestannouncement: 'date',
  judge_organizationrequest: 'time',
};

const isValidDate = (at: unknown): at is Date =>
  at instanceof Date && !isNaN(at.getTime());

/** A UUIDv7 stamped with `at`; a missing or zero date falls back to now. */
export const newIdAt = (at: unknown): string =>
  isValidDate(at) ? v7({ msecs: at.getTime() }) : newId();

type IdEntry = { table: string; legacyId: number; id: string };

@Injectable()
export class IdMapRepository {
  private readonly logger = new Logger(IdMapRepository.name);
  private cache = new Map<string, Map<number, string>>();

  constructor(
    @InjectConnection() private readonly conn: Connection,
    private readonly source: LegacySourceService,
  ) {}

  private get collection() {
    return this.conn.collection<IdEntry>('migrationIdMap');
  }

  /** Incremental and stable for the given tables (the union of the jobs' `refTables`): only legacy ids without an entry get a new uuid. Tables no job references get no entries (13M-row logs stay out). */
  async build(tables: readonly string[]) {
    this.cache.clear();
    await this.collection.createIndex(
      { table: 1, legacyId: 1 },
      { unique: true },
    );
    const wanted = new Set(tables);
    // An alias reuses its target's uuids, so the target is always built.
    for (const [alias, { target }] of Object.entries(ALIASES))
      if (wanted.has(alias)) wanted.add(target);
    const existing = await this.source.query<{ tableName: string }>(
      "SELECT table_name AS tableName FROM information_schema.columns WHERE table_schema = DATABASE() AND column_name = 'id' AND column_key = 'PRI'",
    );
    const found = new Set(existing.map(({ tableName }) => tableName));
    for (const missing of wanted)
      if (!found.has(missing))
        this.logger.warn(`${missing}: no such table with an id primary key`);
    for (const { tableName } of existing)
      if (wanted.has(tableName) && !(tableName in ALIASES))
        await this.syncTable(tableName);
    for (const [tableName, { sql, target }] of Object.entries(ALIASES))
      if (wanted.has(tableName)) {
        await this.load([target]);
        // A profile whose user is gone gets no entry (the audit counts it): one orphan must not abort the build.
        const orphans = await this.sync(
          tableName,
          this.source.stream<{ id: number; target: number }>(sql),
          (row) => this.find(target, row.target),
        );
        if (orphans)
          this.logger.warn(
            `${tableName}: ${orphans} row(s) whose ${target} is gone get no id`,
          );
      }
  }

  private async syncTable(table: string): Promise<void> {
    const column = TIMED_TABLES[table];
    if (!column) {
      await this.sync(
        table,
        this.source.stream<{ id: number }>(
          `SELECT id FROM \`${table}\` ORDER BY id`,
        ),
        () => newId(),
      );
      return;
    }
    let undated = 0;
    await this.sync(
      table,
      this.source.stream<{ id: number; at: unknown }>(
        `SELECT id, \`${column}\` AS at FROM \`${table}\` ORDER BY id`,
      ),
      (row) => {
        if (!isValidDate(row.at)) undated += 1;
        return newIdAt(row.at);
      },
    );
    if (undated)
      this.logger.warn(
        `${table}: ${undated} row(s) without a creation time get a current-time id`,
      );
  }

  async load(tables: string[]) {
    for (const table of tables.filter((name) => !this.cache.has(name)))
      this.cache.set(
        table,
        new Map(
          (await this.collection.find({ table }).toArray()).map((entry) => [
            entry.legacyId,
            entry.id,
          ]),
        ),
      );
  }

  /** Like `get`, but undefined for a legacy id with no entry (a dangling reference). */
  find(table: string, legacyId: number): string | undefined {
    return this.cache.get(table)?.get(legacyId);
  }

  get(table: string, legacyId: number): string {
    const id = this.cache.get(table)?.get(legacyId);
    if (!id) throw new Error(`no uuid for ${table}:${legacyId}`);
    return id;
  }

  /** Memory stays bounded by one batch: existing entries are looked up per batch, never cached whole (tables reach tens of millions of rows). Returns how many rows got no entry. */
  private async sync<Row extends { id: number }>(
    table: string,
    rows: AsyncIterable<Row>,
    resolve: (row: Row) => string | undefined,
  ): Promise<number> {
    this.cache.delete(table);
    let unresolved = 0;
    for await (const batch of batched(rows, 5000)) {
      const known = new Set(
        await this.collection.distinct('legacyId', {
          table,
          legacyId: { $in: batch.map((row) => row.id) },
        }),
      );
      const fresh = batch
        .filter((row) => !known.has(row.id))
        .flatMap((row) => {
          const id = resolve(row);
          if (id === undefined) unresolved += 1;
          return id === undefined ? [] : [{ table, legacyId: row.id, id }];
        });
      if (fresh.length) await this.collection.insertMany(fresh);
    }
    return unresolved;
  }
}
