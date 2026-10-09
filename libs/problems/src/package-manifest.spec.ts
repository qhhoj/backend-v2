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
    name: 'Sum',
    source: 'Practice',
    description: 'Add two numbers.',
    descriptionHtml: '<p>Add two numbers.</p>',
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
  it('starts with the English base statement and adds each translation', () => {
    const statements = packageStatements(
      problem({
        translations: [
          { language: 'vi', name: 'Tong', description: 'Cong hai so.' },
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

  it('lets an English translation override the base statement', () => {
    const [english] = packageStatements(
      problem({
        translations: [{ language: 'en', name: 'Sum v2', description: 'Add.' }],
      }),
    );
    expect(english).toMatchObject({ name: 'Sum v2', text: 'Add.' });
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
      statements: [{ language: 'en', name: 'Sum', file: 'statements/en.md' }],
      data: { checker: 'standard', files: { archive: 'tests.zip' } },
    });
    expect(manifest.data.cases).toHaveLength(1);
    expect(JSON.stringify(manifest)).not.toContain('Add two numbers.');
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);
  });

  it('names the uploaded files by their stored name', () => {
    const manifest = buildManifest(
      problem({
        materialUrl: 'http://x/media/materials/abc/Notes v2.txt',
        pdfStatementUrl: 'http://x/media/pdf/sum.pdf',
      }),
    );
    expect(manifest.material).toBe('Notes_v2.txt');
    expect(manifest.uploadedStatement).toBe('uploaded.pdf');
  });
});

describe('packageKey', () => {
  const key = (extra: Record<string, unknown> = {}) =>
    packageKey(problem({ ...extra, _id: 'fixed' }));

  it('is dataVersion, a dot and 12 hex digits, and stable', () => {
    expect(key()).toMatch(/^3\.[0-9a-f]{12}$/);
    expect(key()).toBe(key());
  });

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
    ];
    for (const other of changed) expect(other).not.toBe(base);
    expect(new Set(changed).size).toBe(changed.length);
  });

  it('moves when only the PDF statement URL changes, the way a PDF re-upload does', () => {
    const first = key({ pdfStatementUrl: 'http://x/media/pdf/one.pdf' });
    const second = key({ pdfStatementUrl: 'http://x/media/pdf/two.pdf' });
    expect(second).not.toBe(first);
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
