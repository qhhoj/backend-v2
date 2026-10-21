import { newId } from '@libs/database';
import type { Problem } from '@libs/database';
import {
  buildManifest,
  packageKey,
  packageStatements,
} from './package-manifest';

const problem = (extra: Record<string, unknown> = {}): Problem =>
  ({
    _id: newId(),
    code: 'sum',
    name: 'Tong',
    source: 'Practice',
    description: 'Cong hai so.',
    descriptionHtml: '<p>Cong hai so.</p>',
    timeLimit: 1,
    memoryLimit: 65536,
    points: 1000,
    partial: true,
    isFullMarkup: false,
    allowedLanguages: [],
    languageLimits: [],
    translations: [],
    data: null,
    materialUrl: null,
    pdfStatementUrl: null,
    dataVersion: 3,
    userCount: 0,
    acRate: 0,
    ...extra,
  }) as unknown as Problem;

const caseRow = (input: string) => ({
  type: 'C',
  input,
  output: `${input}.out`,
  points: 100,
  isPretest: false,
  generatorArgs: '',
  checker: '',
  checkerArgs: null,
  outputPrefix: null,
  outputLimit: null,
});
const withData = (cases: unknown[], extra: Record<string, unknown> = {}) => ({
  archive: 'tests.zip',
  generator: null,
  customChecker: null,
  customGrader: null,
  customHeader: null,
  checker: 'standard',
  checkerArgs: null,
  grader: 'standard',
  graderArgs: null,
  outputPrefix: null,
  outputLimit: null,
  unicode: false,
  nobigmath: false,
  feedback: '',
  cases,
  ...extra,
});

describe('packageStatements', () => {
  it('starts with the Vietnamese base statement and adds each translation', () => {
    const statements = packageStatements(
      problem({
        translations: [
          { language: 'en', name: 'Sum', description: 'Add two numbers.' },
        ],
      }),
    );
    expect(
      statements.map((row) => [row.language, row.file, row.name, row.text]),
    ).toEqual([
      ['en', 'statements/en.md', 'Sum', 'Add two numbers.'],
      ['vi', 'statements/vi.md', 'Tong', 'Cong hai so.'],
    ]);
  });

  it('lets a base-language translation override the base statement', () => {
    const [base] = packageStatements(
      problem({
        translations: [
          { language: 'vi', name: 'Tong v2', description: 'Them.' },
        ],
      }),
    );
    expect(base).toMatchObject({ name: 'Tong v2', text: 'Them.' });
  });
});

describe('buildManifest', () => {
  it('names the format, lists the statement files and keeps statement text out', () => {
    const manifest = buildManifest(
      problem({ data: withData([caseRow('1.in')]) }),
    );
    expect(manifest).toMatchObject({
      format: 'qhhoj-package',
      formatVersion: 1,
      problem: { code: 'sum', points: 1000, timeLimit: 1, memoryLimit: 65536 },
      statements: [{ language: 'vi', name: 'Tong', file: 'statements/vi.md' }],
      data: { checker: 'standard', files: { archive: 'tests.zip' } },
    });
    expect(JSON.stringify(manifest)).not.toContain('Cong hai so.');
  });

  it('states whether an interactive problem runs its checker and the headers its sources compile with', () => {
    const interactive = buildManifest(
      problem({
        data: withData([caseRow('1.in')], {
          grader: 'interactive',
          customGrader: 'interactor.cpp',
          interactiveChecker: true,
          helperHeaders: ['testlib.h', 'constraints.h'],
        }),
      }),
    );
    expect(interactive.data).toMatchObject({
      interactiveChecker: true,
      helperHeaders: ['testlib.h', 'constraints.h'],
    });
    // A row from before both fields existed reads as the legacy rule, no headers.
    expect(
      buildManifest(problem({ data: withData([caseRow('1.in')]) })).data,
    ).toMatchObject({ interactiveChecker: false, helperHeaders: [] });
  });
});

describe('packageKey', () => {
  const key = (extra: Record<string, unknown> = {}) =>
    packageKey(problem({ ...extra, _id: 'fixed' }));

  it('changes with everything the package states', () => {
    const base = key({ data: withData([caseRow('1.in')]) });
    const changed = [
      key({ data: withData([caseRow('1.in')]), description: 'Other text.' }),
      key({ data: withData([caseRow('1.in')]), name: 'Sum 2' }),
      key({ data: withData([caseRow('1.in')]), timeLimit: 2 }),
      key({ data: withData([caseRow('1.in')]), points: 900 }),
      key({ data: withData([caseRow('2.in')]) }),
      key({ data: withData([caseRow('1.in')]), dataVersion: 4 }),
      key({
        data: withData([caseRow('1.in')]),
        translations: [{ language: 'vi', name: 'T', description: 'x' }],
      }),
      key({
        data: withData([caseRow('1.in')]),
        materialUrl: 'http://x/media/materials/a/m.zip',
      }),
      key({
        data: withData([caseRow('1.in')]),
        pdfStatementUrl: 'http://x/media/pdf/one.pdf',
      }),
      key({
        data: withData([caseRow('1.in')]),
        pdfStatementUrl: 'http://x/media/pdf/two.pdf',
      }),
    ];
    expect(changed).not.toContain(base);
    expect(new Set(changed).size).toBe(changed.length);
    expect(key({ data: withData([caseRow('1.in')]) })).toBe(base);
  });

  it('ignores what the package does not state', () => {
    const base = key({ data: withData([caseRow('1.in')]) });
    expect(
      key({
        data: withData([caseRow('1.in')]),
        userCount: 99,
        acRate: 0.5,
        descriptionHtml: '<p>different html</p>',
        isPublic: true,
        authors: [newId()],
      }),
    ).toBe(base);
  });
});
