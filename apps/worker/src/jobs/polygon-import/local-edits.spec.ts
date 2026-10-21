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
  sourceHashes: {
    customChecker: 'polygon-check',
    customGrader: null,
    helperHeaders: {},
  },
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
  {
    sourceHashes: {
      customChecker: 'setter-check',
      customGrader: null,
      helperHeaders: {},
    },
  },
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
      sourceHashes: {
        customChecker: 'fixed',
        customGrader: null,
        helperHeaders: {},
      },
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

  const interactive = (interactiveChecker: boolean) =>
    state(
      {
        sourceHashes: {
          customChecker: 'polygon-check',
          customGrader: 'i',
          helperHeaders: {},
        },
      },
      {
        grader: 'interactive',
        customGrader: 'interactor.cpp',
        interactiveChecker,
      },
    );

  it('treats whether an interactive problem runs its checker as part of the grader', () => {
    expect(
      editedSince(fingerprintsOf(interactive(true)), interactive(false)),
    ).toEqual(['grader']);
    expect(settingsNamedIn(['interactiveChecker'])).toEqual(['grader']);
    const { values, localEdits } = mergeLocalEdits(
      interactive(true),
      { state: interactive(false), edited: ['grader'] },
      false,
    );
    expect(localEdits.kept).toEqual(['grader']);
    expect(values.data.interactiveChecker).toBe(false);
  });

  it('moves an interactor-only problem the setter left alone to running its checker, keeping nothing', () => {
    // A problem imported before `interactiveChecker`, whose record was written then: the flag is false on both sides.
    const legacy = interactive(false);
    const { values, localEdits } = mergeLocalEdits(
      interactive(true),
      { state: legacy, edited: editedSince(fingerprintsOf(legacy), legacy) },
      false,
    );
    expect(localEdits).toEqual({ kept: [], updated: ['grader'] });
    expect(values.data.interactiveChecker).toBe(true);
  });

  describe('helper headers', () => {
    /** An interactive problem whose checker and interactor compile with `headers` (name -> content hash). */
    const withHeaders = (
      headers: Record<string, string>,
      hashes: { customChecker?: string; customGrader?: string } = {},
    ) =>
      state(
        {
          sourceHashes: {
            customChecker: hashes.customChecker ?? 'polygon-check',
            customGrader: hashes.customGrader ?? 'polygon-interactor',
            helperHeaders: headers,
          },
        },
        {
          grader: 'interactive',
          customGrader: 'interactor.cpp',
          interactiveChecker: true,
          helperHeaders: Object.keys(headers),
        },
      );

    it('counts a header change as a change of the checker and the interactor', () => {
      const imported = fingerprintsOf(withHeaders({ 'testlib.h': 'v1' }));
      expect(editedSince(imported, withHeaders({ 'testlib.h': 'v1' }))).toEqual(
        [],
      );
      expect(editedSince(imported, withHeaders({ 'testlib.h': 'v2' }))).toEqual(
        ['checker', 'grader'],
      );
      expect(settingsNamedIn(['helperHeaders'])).toEqual(['checker', 'grader']);
    });

    it('matches a record written before the headers counted', () => {
      const unedited = withHeaders({ 'testlib.h': 'v1' });
      const old = fingerprintsOf(unedited, { withHeaders: false });
      expect(editedSince(old, unedited)).toEqual([]);
      expect(
        editedSince(
          old,
          withHeaders({ 'testlib.h': 'v1' }, { customGrader: 'setter' }),
        ),
      ).toEqual(['grader']);
    });

    it('keeps the headers a kept interactor names beside the package ones, and records them so the checker stays unedited', () => {
      const local = withHeaders(
        { 'testlib.h': 'v1', 'old.h': 'o' },
        { customGrader: 'setter' },
      );
      const incoming = withHeaders(
        { 'testlib.h': 'v2', 'new.h': 'n' },
        { customChecker: 'polygon-check-2' },
      );
      const { values, localEdits, recorded } = mergeLocalEdits(
        incoming,
        { state: local, edited: ['grader'] },
        false,
      );
      expect(localEdits).toEqual({ kept: ['grader'], updated: ['checker'] });
      expect(values.data.helperHeaders).toEqual([
        'testlib.h',
        'old.h',
        'new.h',
      ]);
      // On disk after the sync: the package's testlib.h and new.h, the kept old.h.
      const written = withHeaders(
        { 'testlib.h': 'v2', 'old.h': 'o', 'new.h': 'n' },
        { customChecker: 'polygon-check-2', customGrader: 'setter' },
      );
      expect(editedSince(recorded, written)).toEqual(['grader']);
    });

    it('drops the local headers when nothing that compiles with them is kept', () => {
      const { values } = mergeLocalEdits(
        withHeaders({ 'testlib.h': 'v2' }),
        { state: withHeaders({ 'old.h': 'o' }), edited: [] },
        false,
      );
      expect(values.data.helperHeaders).toEqual(['testlib.h']);
    });
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
