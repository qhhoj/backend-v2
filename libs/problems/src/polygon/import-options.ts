import type {
  PolygonImportOptions,
  StatementLanguageChoice,
} from '@libs/database';
import type { PolygonImportJob } from '../jobs';

/** Every option one Import or Sync runs with, defaults applied. A job carries these fields flat; a Polygon link stores them as `options`. */
export interface ImportOptions {
  /** Polygon statement language of the main statement; null = the only one. */
  mainStatementLanguage: string | null;
  /** Polygon language → site language for the remaining statements, or `skip` to leave one out. */
  statementLanguages: Record<string, StatementLanguageChoice>;
  tutorialLanguage: string | null;
  ignoreZeroPointBatches: boolean;
  ignoreZeroPointCases: boolean;
  appendMainSolution: boolean;
  /** Whether the package statement's tutorial becomes the editorial. */
  importTutorial: boolean;
  /** The testcase limit. Request paths: the requester's (an api permission rule, passed in). Sync and Autosync: the link's. Never PATCHed. */
  maxCases: number;
}

/** The stored form (a Mongoose class, since `libs/database` cannot import this module) must equal `ImportOptions`: drift is a compile error. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
const stored: Equal<ImportOptions, PolygonImportOptions> = true;
void stored;

/** The value of each option a link or a queued job predates. */
export const IMPORT_OPTION_DEFAULTS: Readonly<Omit<ImportOptions, 'maxCases'>> =
  {
    mainStatementLanguage: null,
    statementLanguages: {},
    tutorialLanguage: null,
    ignoreZeroPointBatches: false,
    ignoreZeroPointCases: false,
    appendMainSolution: false,
    importTutorial: true,
  };

/** `english=en`, `russian=skip`: a Polygon statement language and the site language its translation is stored under, or `skip` to leave that statement out. The import and the link options both take this form. */
export const LANGUAGE_PAIR = /^[a-z]+=(en|vi|skip)$/;

/** A stored or queued record that may predate a field: a missing field, or a null on a flag, reads as the default. */
type OptionsRecord = {
  [K in keyof ImportOptions]?: ImportOptions[K] | null;
} & Pick<ImportOptions, 'maxCases'>;

/** `['russian=skip']` → `{ russian: 'skip' }`, as the job and the link store it. Built with `Object.fromEntries`, so a pair named `__proto__` is an own key. */
export const languageMapOf = (
  pairs: string[],
): Record<string, StatementLanguageChoice> =>
  Object.fromEntries(
    pairs.map((pair) => pair.split('=') as [string, StatementLanguageChoice]),
  );

/** The stored map back in the request form, sorted by Polygon language. */
export const languagePairsOf = (
  map: Record<string, StatementLanguageChoice>,
): string[] =>
  Object.entries(map)
    .map(([language, choice]) => `${language}=${choice}`)
    .sort();

/** Options as a Polygon link stores them or a queued job carries them. A field the record predates (undefined, or a stored null on a flag) takes its default. Other fields of the record are ignored. */
export function importOptionsOf(record: OptionsRecord): ImportOptions {
  const defaults = IMPORT_OPTION_DEFAULTS;
  return {
    mainStatementLanguage:
      record.mainStatementLanguage ?? defaults.mainStatementLanguage,
    statementLanguages: record.statementLanguages ?? {
      ...defaults.statementLanguages,
    },
    tutorialLanguage: record.tutorialLanguage ?? defaults.tutorialLanguage,
    ignoreZeroPointBatches:
      record.ignoreZeroPointBatches ?? defaults.ignoreZeroPointBatches,
    ignoreZeroPointCases:
      record.ignoreZeroPointCases ?? defaults.ignoreZeroPointCases,
    appendMainSolution:
      record.appendMainSolution ?? defaults.appendMainSolution,
    importTutorial: record.importTutorial ?? defaults.importTutorial,
    maxCases: record.maxCases,
  };
}

/** Which write a successful job makes to the Polygon link:
 *  - `link`: a link import writes the whole link, options included.
 *  - `sync`: the package and result fields only; the auto-sync switch and the options stay.
 *  - `none`: a zip Import or zip update, even of a linked problem. The link, its options and its `importedSettings` stay as they are. */
export type LinkWrite = 'link' | 'sync' | 'none';
export function linkWriteOf(job: Pick<PolygonImportJob, 'polygon'>): LinkWrite {
  if (!job.polygon) return 'none';
  return job.polygon.purpose === 'link' ? 'link' : 'sync';
}
