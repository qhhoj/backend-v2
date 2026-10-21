import { EMPTY_TEST_CASE, emptyProblemData } from '@libs/database';
import type { ProblemData } from '@libs/database';
import {
  editedSince,
  fingerprintsOf,
  mergeLocalEdits,
  settingsNamedIn,
} from './local-edits';
import type { SettingsState } from './local-edits';

const state = (
  overrides: Partial<Omit<SettingsState, 'data'>> = {},
  data: Partial<ProblemData> = {},
): SettingsState => ({
  timeLimit: 3,
  memoryLimit: 262144,
  partial: true,
  sourceHashes: { customChecker: 'polygon-check', customGrader: null },
  ...overrides,
  data: {
    ...emptyProblemData(),
    archive: 'tests.zip',
    checker: 'bridged',
    customChecker: 'checker.cpp',
    ...data,
  },
});
const themis = state(
  { sourceHashes: { customChecker: 'setter-check', customGrader: null } },
  {
    checker: 'bridged',
    checkerArgs: { type: 'themis' },
    customChecker: 'chk.cpp',
  },
);

describe('local edits', () => {
  it('sees an edit as a value that moved away from the imported one, sources by content', () => {
    const imported = fingerprintsOf(state());
    expect(editedSince(imported, state())).toEqual([]);
    expect(editedSince(imported, state({ timeLimit: 4 }))).toEqual([
      'timeLimit',
    ]);
    const reuploaded = state({
      sourceHashes: { customChecker: 'fixed', customGrader: null },
    });
    expect(editedSince(imported, reuploaded)).toEqual(['checker']);
  });

  it('reads missing checker arguments and {} as the same, whatever the key order', () => {
    const one = state({}, { checkerArgs: { precision: 6, type: 'testlib' } });
    const other = state({}, { checkerArgs: { type: 'testlib', precision: 6 } });
    expect(editedSince(fingerprintsOf(one), other)).toEqual([]);
    expect(
      editedSince(fingerprintsOf(state()), state({}, { checkerArgs: {} })),
    ).toEqual([]);
  });

  it('maps revision fields to settings, ignoring the rest', () => {
    expect(
      settingsNamedIn(['name', 'memoryLimit', 'checkerArgs', 'cases']),
    ).toEqual(['memoryLimit', 'checker']);
    expect(settingsNamedIn(['customGrader', 'graderArgs'])).toEqual(['grader']);
  });

  it('keeps an edited setting the package would change, and reports the rest as updated', () => {
    const local = state({ timeLimit: 4 }, { unicode: true });
    const incoming = state({ memoryLimit: 524288 });
    const { values, localEdits } = mergeLocalEdits(
      incoming,
      { state: local, edited: ['timeLimit'] },
      false,
    );
    expect(localEdits).toEqual({
      kept: ['timeLimit'],
      updated: ['memoryLimit'],
    });
    expect(values.timeLimit).toBe(4);
    expect(values.memoryLimit).toBe(524288);
    expect(values.data.unicode).toBe(true);
  });

  it('keeps the whole checker setting, and takes the tests from the package', () => {
    const incoming = state({}, { cases: [{ ...EMPTY_TEST_CASE }] });
    const { values, localEdits } = mergeLocalEdits(
      incoming,
      { state: themis, edited: ['checker'] },
      false,
    );
    expect(localEdits.kept).toEqual(['checker']);
    expect(values.data).toMatchObject({
      checker: 'bridged',
      checkerArgs: { type: 'themis' },
      customChecker: 'chk.cpp',
    });
    expect(values.data.cases).toBe(incoming.data.cases);
  });

  it('reports nothing for an edit the package now agrees with', () => {
    const { localEdits } = mergeLocalEdits(
      state({ timeLimit: 4 }),
      { state: state({ timeLimit: 4 }), edited: ['timeLimit'] },
      false,
    );
    expect(localEdits).toEqual({ kept: [], updated: [] });
  });

  it('restores the package values on overwrite, reporting the edits as updated', () => {
    const { values, localEdits } = mergeLocalEdits(
      state(),
      { state: themis, edited: ['checker'] },
      true,
    );
    expect(localEdits).toEqual({ kept: [], updated: ['checker'] });
    expect(values.data.customChecker).toBe('checker.cpp');
    expect(values.data.checkerArgs).toBeNull();
  });
});
