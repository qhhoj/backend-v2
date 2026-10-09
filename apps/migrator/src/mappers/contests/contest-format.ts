import { FormatConfigError, parseFormatConfig } from '@libs/contests';
import { CONTEST_FORMAT_NAMES } from '@libs/database';
import type { ContestFormatName } from '@libs/database';
import { MapCtx } from '../../mapper';

const RENAMED: Record<string, ContestFormatName> = { Ultimate: 'ultimate' };
/** Legacy keys v2 does not keep, per format. */
const DROPPED: Partial<Record<ContestFormatName, string[]>> = {
  final_submission: ['cumtime'],
};
/** Legacy keys v2 spells differently, per format; applied instead of camelCasing (`camel('LSO')` is `LSO`). */
const RENAMED_KEYS: Partial<Record<ContestFormatName, Record<string, string>>> =
  { vnoj: { LSO: 'lso' } };

const camel = (key: string) =>
  key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());

export function camelConfig(
  raw: unknown,
  name: ContestFormatName,
): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const dropped = DROPPED[name] ?? [];
  const renamed = RENAMED_KEYS[name] ?? {};
  return Object.fromEntries(
    Object.entries(raw)
      .filter(([key]) => !dropped.includes(key))
      .map(([key, value]) => [renamed[key] ?? camel(key), value]),
  );
}

const isFormatName = (name: string): name is ContestFormatName =>
  (CONTEST_FORMAT_NAMES as readonly string[]).includes(name);

interface FormatRow {
  id: number;
  format_name: string;
  format_config: string | null;
}

export function formatOf(row: FormatRow, ctx: MapCtx) {
  const where = `judge_contest:${row.id}`;
  const name: string = RENAMED[row.format_name] ?? row.format_name;
  if (!isFormatName(name)) {
    ctx.report(`${where} format "${row.format_name}" → default`);
    return { formatName: 'default' as const, formatConfig: {} };
  }
  try {
    const raw = ctx.json(row.format_config, `${where} format_config`);
    return {
      formatName: name,
      formatConfig: parseFormatConfig(name, camelConfig(raw, name)),
    };
  } catch (error) {
    if (!(error instanceof FormatConfigError)) throw error;
    ctx.report(`${where} format_config refused → defaults`);
    return { formatName: name, formatConfig: parseFormatConfig(name, {}) };
  }
}
