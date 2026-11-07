import {
  importOptionsOf,
  languageMapOf,
  languagePairsOf,
  linkWriteOf,
} from './import-options';

const stored = {
  mainStatementLanguage: 'english',
  statementLanguages: { russian: 'skip' as const },
  tutorialLanguage: 'english',
  ignoreZeroPointBatches: true,
  ignoreZeroPointCases: true,
  appendMainSolution: true,
  importTutorial: false,
  maxCases: 9999,
};

describe('import options', () => {
  it('turns pairs into a map with own keys, and back into sorted pairs', () => {
    const map = languageMapOf([
      'vietnamese=vi',
      'russian=skip',
      '__proto__=en',
    ]);
    expect(map).toEqual({
      vietnamese: 'vi',
      russian: 'skip',
      ['__proto__']: 'en',
    });
    expect(Object.hasOwn(map, '__proto__')).toBe(true);
    expect(languagePairsOf({ vietnamese: 'vi', russian: 'skip' })).toEqual([
      'russian=skip',
      'vietnamese=vi',
    ]);
  });

  it('re-applies a link with its own testcase limit', () => {
    expect(importOptionsOf(stored)).toEqual(stored);
  });

  it('reads an old link or queued job: absent fields default, extra fields drop', () => {
    const job = {
      ...stored,
      importTutorial: undefined,
      code: 'ABC',
      mode: 'update',
    };
    expect(importOptionsOf(job)).toEqual({ ...stored, importTutorial: true });
    expect(
      importOptionsOf({ ...stored, appendMainSolution: null }),
    ).toMatchObject({ appendMainSolution: false });
  });

  it('writes the whole link for a link import, the sync fields for a sync, nothing for a zip', () => {
    const source = (purpose: 'link' | 'sync') =>
      ({ polygon: { purpose } }) as Parameters<typeof linkWriteOf>[0];
    expect(linkWriteOf(source('link'))).toBe('link');
    expect(linkWriteOf(source('sync'))).toBe('sync');
    expect(linkWriteOf({})).toBe('none');
  });
});
