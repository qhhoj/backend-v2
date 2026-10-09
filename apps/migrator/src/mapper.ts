import { Document, UUID } from 'mongodb';
import type { RenderStyle } from '@libs/render';
import { LegacySourceService } from './legacy-source.service';

export interface MapCtx {
  /** The uuid of a legacy row that must exist; throws when the id map has none. */
  ref(table: string, id: number | null): UUID | null;
  refs(table: string, ids: number[]): UUID[];
  /** Null plus a `dangling <table>:<id>` report when the legacy row points at a missing row. */
  refOrNull(table: string, id: number | null): UUID | null;
  date(value: unknown): Date | null;
  bool(value: unknown): boolean;
  /** Parsed JSON; empty is null; invalid is null plus an `invalid JSON <where>` report. */
  json(value: unknown, where: string): unknown;
  /** `renderMarkdown`; a render-limit hit stores '' plus a report naming `where`. */
  render(text: string | null, style: RenderStyle, where: string): string;
  report(message: string): void;
}

/** A document keyed by a uuid _id. */
export type MappedDocument = Document & { _id: UUID };

/** Rows of a one-to-many child table, streamed ordered by `key` (the parent's legacy `id`) and handed to `map` per parent. */
export interface ChildQuery<Child> {
  sql: string;
  key: keyof Child & string;
}

/** A backfill job: addressed by `name`, writes `collection`. */
export interface Mapper<Row = any, Child = any> {
  name: string;
  collection: string;
  /** Legacy tables whose ids this mapper resolves (including its own); the id map is built for the union of these. */
  refTables: string[];
  /** Must select the legacy primary key as `id` and be ordered by it. */
  sql: string;
  children?: ChildQuery<Child>;
  prepare?(source: LegacySourceService): Promise<void>;
  /** Null skips the row (it must also `ctx.report` why); verify then expects no document for it. */
  map(row: Row, ctx: MapCtx, children: Child[]): MappedDocument | null;
  /** Replace non-deterministic or recompute-owned fields before verify compares (applied to both sides). */
  normalize?(doc: MappedDocument): Document;
}

/** `doc` without `fields`: what a `normalize` returns for recompute-owned fields. */
export const withoutFields = (
  doc: Document,
  fields: readonly string[],
): Document =>
  Object.fromEntries(
    Object.entries(doc).filter(([key]) => !fields.includes(key)),
  );

export const MAPPERS = Symbol('MAPPERS');

export async function* batched<T>(
  items: AsyncIterable<T>,
  size: number,
): AsyncGenerator<T[]> {
  const batch: T[] = [];
  for await (const item of items)
    if (batch.push(item) === size) yield batch.splice(0);
  if (batch.length) yield batch;
}

export function groupBy<T, V>(
  rows: T[],
  key: keyof T,
  value: (row: T) => V,
): Map<number, V[]> {
  const groups = new Map<number, V[]>();
  for (const row of rows) {
    const groupKey = row[key] as number;
    (groups.get(groupKey) ?? groups.set(groupKey, []).get(groupKey)!).push(
      value(row),
    );
  }
  return groups;
}
