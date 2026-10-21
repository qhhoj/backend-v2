import { createHash } from 'node:crypto';
import { canonicalJson } from '@libs/common';
import { SYNCED_SETTINGS } from '@libs/database';
import type {
  ProblemData,
  SyncedSetting,
  SyncedSettingFingerprints,
} from '@libs/database';
import type { LocalEdits } from '@libs/problems';

/** The data fields a setter edits as one setting: the checker, and how a submission runs. */
const CHECKER_FIELDS = ['checker', 'checkerArgs', 'customChecker'] as const;
const GRADER_FIELDS = [
  'grader',
  'graderArgs',
  'customGrader',
  'customHeader',
  'interactiveChecker',
] as const;
/** Judging options a Polygon package has no say in: a sync always keeps the problem's. */
const LOCAL_ONLY_FIELDS = [
  'unicode',
  'nobigmath',
  'outputPrefix',
  'outputLimit',
] as const;

/** Revision `changes` keys (the editor's fields and `dataChanges`) and the settings each belongs to; the helper headers serve the checker and the interactor alike. */
const SETTINGS_OF_FIELD: Record<string, SyncedSetting[]> = {
  timeLimit: ['timeLimit'],
  memoryLimit: ['memoryLimit'],
  partial: ['partial'],
  ...Object.fromEntries(CHECKER_FIELDS.map((field) => [field, ['checker']])),
  ...Object.fromEntries(GRADER_FIELDS.map((field) => [field, ['grader']])),
  helperHeaders: ['checker', 'grader'],
};

/** The values a sync writes or keeps, as a problem holds them. */
export interface SyncedValues {
  timeLimit: number;
  memoryLimit: number;
  partial: boolean;
  data: ProblemData;
}

/** The content of the sources `data` names: sha256, null when it names none or the file is gone. */
export interface SourceHashes {
  customChecker: string | null;
  customGrader: string | null;
  /** By header name; a name `data.helperHeaders` lists that is missing here reads as a lost file. */
  helperHeaders: Record<string, string | null>;
}

/** The values with the content of the sources they name. */
export interface SettingsState extends SyncedValues {
  sourceHashes: SourceHashes;
}

/** The problem as a sync finds it, and which settings the setter changed on QHHOJ since the last import. */
export interface LocalSettings {
  state: SettingsState;
  edited: SyncedSetting[];
}

const sha256 = (content: string | Buffer): string =>
  createHash('sha256').update(content).digest('hex');
const fingerprint = (value: unknown): string => sha256(canonicalJson(value));

/** What `sourceHashes` holds for a source's bytes (null: no source). */
export const sourceHashOf = (content: Buffer | null): string | null =>
  content && sha256(content);

/** The headers a checker or interactor `source` compiles with, by name and content: an empty part when there is no source or no header, so such a setting digests as it did before headers counted. */
function headersPart(
  { data, sourceHashes }: SettingsState,
  source: string | null,
): unknown[] {
  const names = data.helperHeaders ?? [];
  if (!source || names.length === 0) return [];
  return [
    names.map((name) => [name, sourceHashes.helperHeaders[name] ?? null]),
  ];
}

/**
 * One digest per setting, equal exactly when its values are (sources and headers by content, missing arguments as `{}`).
 * `withHeaders: false` is the digest records written before the headers counted hold.
 */
export function fingerprintsOf(
  state: SettingsState,
  { withHeaders = true } = {},
): SyncedSettingFingerprints {
  const { data, sourceHashes } = state;
  const headers = (source: string | null) =>
    withHeaders ? headersPart(state, source) : [];
  return {
    timeLimit: fingerprint(state.timeLimit),
    memoryLimit: fingerprint(state.memoryLimit),
    partial: fingerprint(state.partial),
    checker: fingerprint([
      data.checker,
      data.checkerArgs ?? {},
      sourceHashes.customChecker,
      ...headers(data.customChecker),
    ]),
    grader: fingerprint([
      data.grader,
      data.graderArgs ?? {},
      data.customHeader,
      sourceHashes.customGrader,
      // Only when set, so a record written before the field existed still matches an unedited problem.
      ...(data.interactiveChecker ? ['interactiveChecker'] : []),
      ...headers(data.customGrader),
    ]),
  };
}

/** Settings whose value moved away from what the last import wrote. A record from before the headers counted is matched without them (the two digests never collide: they hash lists of different lengths). */
export function editedSince(
  imported: SyncedSettingFingerprints,
  current: SettingsState,
): SyncedSetting[] {
  const now = fingerprintsOf(current);
  const withoutHeaders = fingerprintsOf(current, { withHeaders: false });
  return SYNCED_SETTINGS.filter(
    (setting) =>
      now[setting] !== imported[setting] &&
      withoutHeaders[setting] !== imported[setting],
  );
}

/** For a link from before the imported values were recorded: the settings the revisions since the last import name. A source re-uploaded under its old name leaves no revision, so it is not seen. */
export function settingsNamedIn(changedFields: string[]): SyncedSetting[] {
  const named = new Set(
    changedFields.flatMap((field) => SETTINGS_OF_FIELD[field] ?? []),
  );
  return SYNCED_SETTINGS.filter((setting) => named.has(setting));
}

const pick = <Field extends keyof ProblemData>(
  data: ProblemData,
  fields: readonly Field[],
): Pick<ProblemData, Field> =>
  Object.fromEntries(fields.map((field) => [field, data[field]])) as Pick<
    ProblemData,
    Field
  >;

/** The header names a sync writes: the package's, after those a kept checker or interactor compiles with (they stay on disk; a package header of the same name replaces its content). */
function writtenHeaders(
  incoming: SyncedValues,
  local: SyncedValues,
  kept: SyncedSetting[],
): string[] {
  const { data } = local;
  const keepsHeaders =
    (kept.includes('checker') && data.customChecker !== null) ||
    (kept.includes('grader') && data.customGrader !== null);
  const localNames = keepsHeaders ? (data.helperHeaders ?? []) : [];
  return [...new Set([...localNames, ...incoming.data.helperHeaders])];
}

/** The package's values with the kept settings, their headers and the local-only options taken from the problem. */
function withKept(
  incoming: SyncedValues,
  local: SyncedValues,
  kept: SyncedSetting[],
): SyncedValues {
  const keeps = (setting: SyncedSetting) => kept.includes(setting);
  return {
    timeLimit: keeps('timeLimit') ? local.timeLimit : incoming.timeLimit,
    memoryLimit: keeps('memoryLimit')
      ? local.memoryLimit
      : incoming.memoryLimit,
    partial: keeps('partial') ? local.partial : incoming.partial,
    data: {
      ...incoming.data,
      ...pick(local.data, LOCAL_ONLY_FIELDS),
      ...(keeps('checker') && pick(local.data, CHECKER_FIELDS)),
      ...(keeps('grader') && pick(local.data, GRADER_FIELDS)),
      helperHeaders: writtenHeaders(incoming, local, kept),
    },
  };
}

/** What the link records: the package's own settings, beside the header set the sync wrote, so a setting the setter leaves alone still matches the record next time. */
function recordedState(
  incoming: SettingsState,
  written: SyncedValues,
  local: SettingsState,
): SettingsState {
  return {
    ...incoming,
    data: { ...incoming.data, helperHeaders: written.data.helperHeaders },
    sourceHashes: {
      ...incoming.sourceHashes,
      helperHeaders: {
        ...local.sourceHashes.helperHeaders,
        ...incoming.sourceHashes.helperHeaders,
      },
    },
  };
}

/**
 * What a sync writes: the package's settings, except each one the setter edited on QHHOJ since the last import that
 * the package would change, which keeps the problem's value unless `overwrite`. Tests always come from the package.
 */
export function mergeLocalEdits(
  incoming: SettingsState,
  local: LocalSettings,
  overwrite: boolean,
): {
  values: SyncedValues;
  localEdits: LocalEdits;
  recorded: SyncedSettingFingerprints;
} {
  const before = fingerprintsOf(local.state);
  const after = fingerprintsOf(incoming);
  const changed = SYNCED_SETTINGS.filter(
    (setting) => before[setting] !== after[setting],
  );
  const kept = overwrite
    ? []
    : changed.filter((setting) => local.edited.includes(setting));
  const values = withKept(incoming, local.state, kept);
  const recorded = fingerprintsOf(recordedState(incoming, values, local.state));
  return {
    values,
    localEdits: {
      kept,
      // A setting the sync writes is recorded as written: one whose only change was a kept header is not updated.
      updated: changed.filter(
        (setting) =>
          !kept.includes(setting) && recorded[setting] !== before[setting],
      ),
    },
    recorded,
  };
}
