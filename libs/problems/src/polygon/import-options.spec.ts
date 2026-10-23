import {
  IMPORT_OPTION_DEFAULTS,
  importOptionsOf,
  jobOptionsOf,
  linkWriteOf,
  optionsViewOf,
  patchedOptionsOf,
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
  it('defaults every option a request leaves out and takes the requester limit', () => {
    expect(
      jobOptionsOf({ from: 'request', input: {}, requesterMaxCases: 300 }),
    ).toEqual({ ...IMPORT_OPTION_DEFAULTS, maxCases: 300 });
  });

  it('turns request pairs into a map and keeps the flags given', () => {
    const options = jobOptionsOf({
      from: 'request',
      input: {
        statementLanguages: ['vietnamese=vi', 'russian=skip', '__proto__=en'],
        appendMainSolution: true,
        importTutorial: false,
      },
      requesterMaxCases: 300,
    });
    expect(options.statementLanguages).toEqual({
      vietnamese: 'vi',
      russian: 'skip',
      ['__proto__']: 'en',
    });
    expect(Object.hasOwn(options.statementLanguages, '__proto__')).toBe(true);
    expect(options).toMatchObject({
      appendMainSolution: true,
      importTutorial: false,
    });
  });

  it('re-applies a link with its own testcase limit', () => {
    expect(jobOptionsOf({ from: 'link', stored })).toEqual(stored);
  });

  it('reads an old link or queued job: absent fields default, extra fields drop', () => {
    expect(importOptionsOf({ maxCases: 300 })).toEqual({
      ...IMPORT_OPTION_DEFAULTS,
      maxCases: 300,
    });
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

  it('patches: omitted keeps, null clears a language and is ignored on a flag, pairs replace the map', () => {
    expect(patchedOptionsOf(stored, {})).toEqual(stored);
    expect(
      patchedOptionsOf(stored, {
        mainStatementLanguage: null,
        tutorialLanguage: null,
        appendMainSolution: null as unknown as undefined,
        statementLanguages: ['vietnamese=vi'],
      }),
    ).toEqual({
      ...stored,
      mainStatementLanguage: null,
      tutorialLanguage: null,
      statementLanguages: { vietnamese: 'vi' },
    });
  });

  it('views the map as sorted pairs', () => {
    expect(
      optionsViewOf({
        ...stored,
        statementLanguages: { vietnamese: 'vi', russian: 'skip' },
      }).statementLanguages,
    ).toEqual(['russian=skip', 'vietnamese=vi']);
  });

  it('writes the whole link for a link import, the sync fields for a sync, nothing for a zip', () => {
    const source = (purpose: 'link' | 'sync') =>
      ({ polygon: { purpose } }) as Parameters<typeof linkWriteOf>[0];
    expect(linkWriteOf(source('link'))).toBe('link');
    expect(linkWriteOf(source('sync'))).toBe('sync');
    expect(linkWriteOf({})).toBe('none');
  });
});
