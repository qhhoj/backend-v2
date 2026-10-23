import type {
  PolygonImportOptions,
  StatementLanguageChoice,
} from '@libs/database';
import type { PolygonImportJob } from '../queues';

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

/** The value of each option a request leaves out, and of each field that a link or a queued job predates. */
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

/** The request form (query or JSON body) and the PATCH form: every option optional, `statementLanguages` as `<polygon language>=<en|vi|skip>` pairs. There is no `maxCases`. */
export type ImportOptionsInput = Partial<
  Omit<ImportOptions, 'statementLanguages' | 'maxCases'>
> & { statementLanguages?: string[] };

/** The view form: `statementLanguages` as pairs. */
export type ImportOptionsView = Omit<ImportOptions, 'statementLanguages'> & {
  statementLanguages: string[];
};

/** `english=en`, `russian=skip`: a Polygon statement language and the site language its translation is stored under, or `skip` to leave that statement out. */
export const LANGUAGE_PAIR = /^[a-z]+=(en|vi|skip)$/;

/** A stored or queued record that may predate a field: a missing field, or a null on a flag, reads as the default. */
type OptionsRecord = {
  [K in keyof ImportOptions]?: ImportOptions[K] | null;
} & Pick<ImportOptions, 'maxCases'>;

/** `['russian=skip']` → `{ russian: 'skip' }`. Built with `Object.fromEntries`, so a pair named `__proto__` is an own key. */
const languageMapOf = (
  pairs: string[],
): Record<string, StatementLanguageChoice> =>
  Object.fromEntries(
    pairs.map((pair) => pair.split('=') as [string, StatementLanguageChoice]),
  );

/** Options as a Polygon link stores them or a queued job carries them. A field the record predates (undefined, or a stored null on a flag) takes its default. Other fields of the record are ignored. */
export function importOptionsOf(record: OptionsRecord): ImportOptions {
  const defaults = IMPORT_OPTION_DEFAULTS;
  return {
    mainStatementLanguage:
      record.mainStatementLanguage ?? defaults.mainStatementLanguage,
    statementLanguages: record.statementLanguages ?? {},
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

/** Which options a job runs with (the one written rule):
 *  - `request`: a first Import, a link import, a zip update. The request's options, absent ones defaulted, with the requester's testcase limit.
 *  - `link`: a Sync or an Autosync. The link's stored options re-applied, its testcase limit included. */
export function jobOptionsOf(
  source:
    | { from: 'request'; input: ImportOptionsInput; requesterMaxCases: number }
    | { from: 'link'; stored: OptionsRecord },
): ImportOptions {
  if (source.from === 'link') return importOptionsOf(source.stored);
  const { statementLanguages, ...flags } = source.input;
  return importOptionsOf({
    ...flags,
    statementLanguages: languageMapOf(statementLanguages ?? []),
    maxCases: source.requesterMaxCases,
  });
}

/** A PATCH of the link's options. An omitted field keeps its value. `null` clears `mainStatementLanguage` or `tutorialLanguage` and is ignored on a flag, the same as omitting it. `statementLanguages` replaces the whole map. `maxCases` cannot be given. */
export function patchedOptionsOf(
  stored: ImportOptions,
  patch: ImportOptionsInput,
): ImportOptions {
  return {
    mainStatementLanguage:
      patch.mainStatementLanguage === undefined
        ? stored.mainStatementLanguage
        : patch.mainStatementLanguage,
    statementLanguages: patch.statementLanguages
      ? languageMapOf(patch.statementLanguages)
      : stored.statementLanguages,
    tutorialLanguage:
      patch.tutorialLanguage === undefined
        ? stored.tutorialLanguage
        : patch.tutorialLanguage,
    ignoreZeroPointBatches:
      patch.ignoreZeroPointBatches ?? stored.ignoreZeroPointBatches,
    ignoreZeroPointCases:
      patch.ignoreZeroPointCases ?? stored.ignoreZeroPointCases,
    appendMainSolution: patch.appendMainSolution ?? stored.appendMainSolution,
    importTutorial: patch.importTutorial ?? stored.importTutorial,
    maxCases: stored.maxCases,
  };
}

/** The view form: `statementLanguages` as pairs sorted by Polygon language. */
export function optionsViewOf(options: ImportOptions): ImportOptionsView {
  return {
    ...options,
    statementLanguages: Object.entries(options.statementLanguages)
      .map(([language, choice]) => `${language}=${choice}`)
      .sort(),
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
