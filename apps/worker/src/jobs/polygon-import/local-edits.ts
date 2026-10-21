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

/** Revision `changes` keys (the editor's fields and `dataChanges`) and the setting each belongs to. */
const SETTING_OF_FIELD: Record<string, SyncedSetting> = {
  timeLimit: 'timeLimit',
  memoryLimit: 'memoryLimit',
  partial: 'partial',
  ...Object.fromEntries(CHECKER_FIELDS.map((field) => [field, 'checker'])),
  ...Object.fromEntries(GRADER_FIELDS.map((field) => [field, 'grader'])),
};

/** The values a sync writes or keeps, as a problem holds them. */
export interface SyncedValues {
  timeLimit: number;
  memoryLimit: number;
  partial: boolean;
  data: ProblemData;
}

/** The values with the content of the checker and interactor source `data` names: sha256, null when it names none or the file is gone. */
export interface SettingsState extends SyncedValues {
  sourceHashes: { customChecker: string | null; customGrader: string | null };
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

/** One digest per setting, equal exactly when its values are (sources by content, missing arguments as `{}`). */
export function fingerprintsOf(
  state: SettingsState,
): SyncedSettingFingerprints {
  const { data, sourceHashes } = state;
  return {
    timeLimit: fingerprint(state.timeLimit),
    memoryLimit: fingerprint(state.memoryLimit),
    partial: fingerprint(state.partial),
    checker: fingerprint([
      data.checker,
      data.checkerArgs ?? {},
      sourceHashes.customChecker,
    ]),
    grader: fingerprint([
      data.grader,
      data.graderArgs ?? {},
      data.customHeader,
      sourceHashes.customGrader,
      // Only when set, so a record written before the field existed still matches an unedited problem.
      ...(data.interactiveChecker ? ['interactiveChecker'] : []),
    ]),
  };
}

/** Settings whose value moved away from what the last import wrote. */
export function editedSince(
  imported: SyncedSettingFingerprints,
  current: SettingsState,
): SyncedSetting[] {
  const now = fingerprintsOf(current);
  return SYNCED_SETTINGS.filter(
    (setting) => now[setting] !== imported[setting],
  );
}

/** For a link from before the imported values were recorded: the settings the revisions since the last import name. A source re-uploaded under its old name leaves no revision, so it is not seen. */
export function settingsNamedIn(changedFields: string[]): SyncedSetting[] {
  const named = new Set(
    changedFields.flatMap((field) => SETTING_OF_FIELD[field] ?? []),
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

/** The package's values with the kept settings and the local-only options taken from the problem. */
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
): { values: SyncedValues; localEdits: LocalEdits } {
  const before = fingerprintsOf(local.state);
  const after = fingerprintsOf(incoming);
  const changed = SYNCED_SETTINGS.filter(
    (setting) => before[setting] !== after[setting],
  );
  const kept = overwrite
    ? []
    : changed.filter((setting) => local.edited.includes(setting));
  return {
    values: withKept(incoming, local.state, kept),
    localEdits: {
      kept,
      updated: changed.filter((setting) => !kept.includes(setting)),
    },
  };
}
