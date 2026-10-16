import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FormatConfigError, parseFormatConfig } from '@libs/contests';
import { Contest } from '@libs/database';
import type { Model } from 'mongoose';

/** Format option names as the old site's admin took them (and their v2 spelling), mapped to the v2 key. */
const FORMAT_KEYS: Record<string, string> = {
  cumtime: 'cumtime',
  last_score_altering: 'lastScoreAltering',
  lastScoreAltering: 'lastScoreAltering',
  penalty: 'penalty',
  LSO: 'lso',
  lso: 'lso',
  auto_judge: 'autoJudge',
  autoJudge: 'autoJudge',
};

/** Only summaries that start like a JSON object are read. */
const JSON_OBJECT_START = /^\s*\{/;

export interface ContestSummaryCleanupCounts {
  /** Summaries that start like a JSON object. */
  found: number;
  /** Format-config summaries emptied this run. */
  cleared: number;
  /** Cleared contests whose format config gained a key from the summary. */
  configFilled: number;
  /** Keys of the cleared contests. */
  clearedKeys: string[];
}

type SummaryRow = Pick<
  Contest,
  '_id' | 'key' | 'summary' | 'formatName' | 'formatConfig'
>;

/** The summary as format options with v2 keys: a non-empty JSON object of known option names and boolean or number values; null for anything else (prose included). */
export function formatOptionsIn(
  summary: string,
): Record<string, boolean | number> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(summary);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    return null;
  const entries = Object.entries(parsed as Record<string, unknown>);
  const isOption = ([key, value]: [string, unknown]) =>
    Object.hasOwn(FORMAT_KEYS, key) &&
    (typeof value === 'boolean' || typeof value === 'number');
  if (entries.length === 0 || !entries.every(isOption)) return null;
  return Object.fromEntries(
    entries.map(([key, value]) => [FORMAT_KEYS[key], value]),
  ) as Record<string, boolean | number>;
}

/** The stored config plus the options it lacks and the format knows; null when nothing is added or the result is invalid. A stored key always wins, defaults included. */
function filledConfig(
  row: SummaryRow,
  options: Record<string, boolean | number>,
): Record<string, unknown> | null {
  const stored = row.formatConfig ?? {};
  const known = parseFormatConfig(row.formatName, {});
  const missing = Object.entries(options).filter(
    ([key]) => Object.hasOwn(known, key) && !Object.hasOwn(stored, key),
  );
  if (missing.length === 0) return null;
  try {
    return parseFormatConfig(row.formatName, {
      ...stored,
      ...Object.fromEntries(missing),
    });
  } catch (error) {
    if (error instanceof FormatConfigError) return null;
    throw error;
  }
}

/**
 * One-off data cleanup, idempotent, so every worker boot may run it. On the old site an organiser typed the format
 * options into a contest's summary (its `format_config` stayed empty) and the migration copied the text, so the contest
 * header and link previews showed raw JSON. This empties such summaries and copies an option the stored config lacks.
 */
@Injectable()
export class ContestSummaryCleanupService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ContestSummaryCleanupService.name);

  constructor(
    @InjectModel(Contest.name) private readonly contests: Model<Contest>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const { found, cleared, configFilled, clearedKeys } = await this.run();
    this.logger.log(
      `Format-config contest summaries: found ${found}, cleared ${cleared}, config filled ${configFilled}${clearedKeys.length ? ` (${clearedKeys.join(', ')})` : ''}`,
    );
  }

  async run(): Promise<ContestSummaryCleanupCounts> {
    const rows = await this.contests
      .find(
        { summary: JSON_OBJECT_START },
        { key: 1, summary: 1, formatName: 1, formatConfig: 1 },
      )
      .lean<SummaryRow[]>()
      .exec();
    const counts: ContestSummaryCleanupCounts = {
      found: rows.length,
      cleared: 0,
      configFilled: 0,
      clearedKeys: [],
    };
    for (const row of rows) {
      const outcome = await this.clean(row);
      if (outcome === 'kept') continue;
      counts.cleared++;
      counts.clearedKeys.push(row.key);
      if (outcome === 'filled') counts.configFilled++;
    }
    return counts;
  }

  /** Writes only while the summary still holds the text read, so a concurrent edit wins. */
  private async clean(row: SummaryRow): Promise<'kept' | 'cleared' | 'filled'> {
    const options = formatOptionsIn(row.summary);
    if (!options) return 'kept';
    const config = filledConfig(row, options);
    const { modifiedCount } = await this.contests
      .updateOne(
        { _id: row._id, summary: row.summary },
        { $set: { summary: '', ...(config && { formatConfig: config }) } },
      )
      .exec();
    if (modifiedCount !== 1) return 'kept';
    return config ? 'filled' : 'cleared';
  }
}
