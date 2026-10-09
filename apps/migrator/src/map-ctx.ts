import { renderMarkdown, RenderLimitError } from '@libs/render';
import type { RenderStyle } from '@libs/render';
import { toUuid } from '@libs/database';
import { IdMapRepository } from './id-map.repository';
import { MapCtx } from './mapper';
import { MigrationReport } from './migration-report';

const parseJson = (value: unknown): unknown =>
  typeof value === 'string' ? (JSON.parse(value) as unknown) : value;

export function createMapCtx(
  ids: IdMapRepository,
  report: MigrationReport,
): MapCtx {
  const ref = (table: string, id: number | null) =>
    id == null ? null : toUuid(ids.get(table, Number(id)));
  return {
    ref,
    refs: (table, list) => list.map((id) => ref(table, id)!),
    refOrNull: (table, id) => {
      if (id == null) return null;
      const found = ids.find(table, Number(id));
      if (!found) report.add(`dangling ${table}:${id}`);
      return found ? toUuid(found) : null;
    },
    date: (value) =>
      value instanceof Date && !isNaN(value.getTime()) ? value : null,
    bool: (value) => Boolean(Number(value)),
    json: (value, where) => {
      if (value == null || value === '') return null;
      try {
        return parseJson(value);
      } catch {
        report.add(`invalid JSON ${where}`);
        return null;
      }
    },
    render: (text, style, where) => renderOrReport(text, style, where, report),
    report: (message) => report.add(message),
  };
}

function renderOrReport(
  text: string | null,
  style: RenderStyle,
  where: string,
  report: MigrationReport,
): string {
  if (!text) return '';
  try {
    return renderMarkdown(text, style);
  } catch (error) {
    if (!(error instanceof RenderLimitError)) throw error;
    report.add(`render limit (${style}) ${where}`);
    return '';
  }
}
