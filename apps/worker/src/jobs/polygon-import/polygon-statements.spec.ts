import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildPolygonPackage,
  properties,
} from '../../../test/polygon-fixtures';
import { PolygonImportError } from './polygon-import.error';
import { PolygonPackage } from './polygon-package';
import {
  assertStatementMarkdown,
  buildDescription,
  parseStatements,
  rehostImages,
  withMainSolution,
} from './polygon-statements';
import type { PolygonImportJob } from '@libs/problems';
import { buildZip, PNG, SVG_WITH_SCRIPT } from '@libs/problems/testing';

const identity = (tex: string) => Promise.resolve(tex);
const job = (overrides: Partial<PolygonImportJob> = {}): PolygonImportJob => ({
  packagePath: '',
  requesterId: 'u',
  code: 'sum',
  mode: 'create',
  authors: [],
  curators: [],
  groupId: 'g',
  typeIds: ['t'],
  allowedLanguages: [],
  points: 800,
  isFullMarkup: false,
  mainStatementLanguage: null,
  statementLanguages: {},
  tutorialLanguage: null,
  ignoreZeroPointBatches: false,
  ignoreZeroPointCases: false,
  appendMainSolution: false,
  ...overrides,
});
const openPackage = async (
  fixture: Parameters<typeof buildPolygonPackage>[0],
) => {
  const path = join(
    mkdtempSync(join(tmpdir(), 'qhhoj-polygon-')),
    'package.zip',
  );
  writeFileSync(path, buildPolygonPackage(fixture));
  return PolygonPackage.open(path);
};

describe('polygon statements', () => {
  it('assembles the description in legacy order with fenced samples', async () => {
    const text = await buildDescription(
      properties({ interaction: 'Talk.', scoring: 'Points.', notes: 'Hint.' }),
      identity,
    );
    expect(text).toBe(
      'Add $a$ and $b$.\n## Input\n\nTwo integers.\n## Output\n\nTheir sum.\n## Interaction\n\nTalk.\n## Scoring\n\nPoints.\n## Sample Input 1\n\n```\n1 2\n```\n\n## Sample Output 1\n\n```\n3\n```\n\n## Notes\n\nHint.',
    );
    expect(
      await buildDescription(properties({ sampleTests: [] }), identity),
    ).not.toContain('Sample');
  });
  it('rehosts markdown and html images from the statement folder, deduplicating by content', async () => {
    const pkg = await openPackage({
      tests: [{ input: '1', answer: '1' }],
      statements: [
        {
          language: 'english',
          name: 'Sum',
          properties: properties(),
          images: { 'fig.png': PNG, 'same.png': PNG },
        },
      ],
    });
    const saved: string[] = [];
    const save = (bytes: Buffer, name: string) => {
      saved.push(name);
      return Promise.resolve(`/media/images/${saved.length}.png`);
    };
    const text = await rehostImages(
      '![image](fig.png) and <img src="same.png" width="10"> and ![image](fig.png)',
      'statements/english',
      pkg,
      save,
    );
    expect(text).toBe(
      '![image](/media/images/1.png) and <img src="/media/images/1.png" width="10"> and ![image](/media/images/1.png)',
    );
    expect(saved).toEqual(['fig.png']);
    await expect(
      rehostImages(
        '![image](../../problem.xml)',
        'statements/english',
        pkg,
        save,
      ),
    ).rejects.toThrow(PolygonImportError);
    await expect(
      rehostImages('![image](missing.png)', 'statements/english', pkg, save),
    ).rejects.toThrow(PolygonImportError);
    pkg.close();
  });
  it('picks the main statement, maps the others to site languages and the tutorial', async () => {
    const pkg = await openPackage({
      tests: [{ input: '1', answer: '1' }],
      statements: [
        {
          language: 'english',
          name: 'Sum',
          properties: properties({ tutorial: 'Add them.' }),
        },
        {
          language: 'vietnamese',
          name: 'Tổng',
          properties: properties({ legend: 'Cộng.', tutorial: 'Cộng lại.' }),
        },
      ],
    });
    const save = () => Promise.resolve('/media/images/x.png');
    await expect(
      parseStatements(await pkg.problemXml(), pkg, job(), identity, save),
    ).rejects.toThrow('invalid main statement language');
    await expect(
      parseStatements(
        await pkg.problemXml(),
        pkg,
        job({ mainStatementLanguage: 'english' }),
        identity,
        save,
      ),
    ).rejects.toThrow('invalid site language for vietnamese');
    const result = await parseStatements(
      await pkg.problemXml(),
      pkg,
      job({
        mainStatementLanguage: 'english',
        statementLanguages: { vietnamese: 'vi' },
        tutorialLanguage: 'vietnamese',
      }),
      identity,
      save,
    );
    expect(result.name).toBe('Sum');
    expect(result.description).toContain('Add $a$ and $b$.');
    expect(result.translations).toEqual([
      {
        language: 'vi',
        name: 'Tổng',
        description: expect.stringContaining('Cộng.') as string,
      },
    ]);
    expect(result.tutorial).toBe('Cộng lại.');
    await expect(
      parseStatements(
        await pkg.problemXml(),
        pkg,
        job({
          mainStatementLanguage: 'english',
          statementLanguages: { vietnamese: 'vi' },
        }),
        identity,
        save,
      ),
    ).rejects.toThrow('invalid main tutorial language');
    pkg.close();
  });
  it('requires a statement and problem-properties.json', async () => {
    const none = await openPackage({ tests: [{ input: '1', answer: '1' }] });
    await expect(
      parseStatements(await none.problemXml(), none, job(), identity, () =>
        Promise.resolve(''),
      ),
    ).rejects.toThrow('statement not found');
    none.close();
  });
  it('appends the main solution as a spoiler with the language fence', () => {
    expect(withMainSolution('Tutorial.\n', 'int main() {}', 'cpp.g++17')).toBe(
      'Tutorial.\n\n<blockquote class="spoiler">\n```cpp\nint main() {}\n```\n</blockquote>\n',
    );
    expect(withMainSolution('', 'print(1)', 'python.3')).toContain(
      '```python\n',
    );
    expect(withMainSolution('', 'x', 'pas.fpc')).toContain('```\nx');
  });
});

const saveEcho =
  (saved: Array<{ bytes: Buffer; name: string }> = []) =>
  (bytes: Buffer, name: string) => {
    saved.push({ bytes, name });
    return Promise.resolve(`/media/images/${saved.length}`);
  };
const englishPackage = (images: Record<string, Buffer>) =>
  openPackage({
    tests: [{ input: '1', answer: '1' }],
    statements: [
      { language: 'english', name: 'Sum', properties: properties(), images },
    ],
  });

describe('rehostImages containment and content', () => {
  it.each([
    '../english/fig.png',
    '/fig.png',
    'https://example.com/fig.png',
    '..\\fig.png',
    'a/../../../problem.xml',
  ])('rejects the image path %p', async (path) => {
    const pkg = await englishPackage({ 'fig.png': PNG });
    await expect(
      rehostImages(`![image](${path})`, 'statements/english', pkg, saveEcho()),
    ).rejects.toThrow(PolygonImportError);
    pkg.close();
  });
  it('rejects an image that sits in the package but outside the statement folder', async () => {
    const pkg = await openPackage({
      tests: [{ input: '1', answer: '1' }],
      statements: [
        { language: 'english', name: 'Sum', properties: properties() },
        {
          language: 'vietnamese',
          name: 'Tổng',
          properties: properties(),
          images: { 'other.png': PNG },
        },
      ],
    });
    await expect(
      rehostImages(
        '![image](other.png)',
        'statements/english',
        pkg,
        saveEcho(),
      ),
    ).rejects.toThrow('image not found');
    pkg.close();
  });
  it('rehosts images from nested folders of the statement', async () => {
    const pkg = await englishPackage({ 'img/fig.png': PNG });
    expect(
      await rehostImages(
        '![image](img/fig.png)',
        'statements/english',
        pkg,
        saveEcho(),
      ),
    ).toBe('![image](/media/images/1)');
    pkg.close();
  });
  it('rejects bytes that are not an image, whatever the file name says', async () => {
    const pkg = await englishPackage({
      'fig.png': Buffer.from('#!/bin/sh\necho hi'),
    });
    await expect(
      rehostImages('![image](fig.png)', 'statements/english', pkg, saveEcho()),
    ).rejects.toThrow('not a supported image');
    pkg.close();
  });
  it('sanitizes SVG before it is saved and names the file by its sniffed type', async () => {
    const pkg = await englishPackage({ 'fig.png': SVG_WITH_SCRIPT });
    const saved: Array<{ bytes: Buffer; name: string }> = [];
    await rehostImages(
      '![image](fig.png)',
      'statements/english',
      pkg,
      saveEcho(saved),
    );
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe('fig.svg');
    expect(saved[0].bytes.toString()).toContain('<svg');
    expect(saved[0].bytes.toString()).not.toMatch(/script|onload|alert/);
    pkg.close();
  });
  it('rejects an image above the size cap', async () => {
    const pkg = await englishPackage({
      'fig.png': Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]),
    });
    await expect(
      rehostImages('![image](fig.png)', 'statements/english', pkg, saveEcho()),
    ).rejects.toThrow(PolygonImportError);
    pkg.close();
  });
  it('does not interpret $ patterns of the stored url', async () => {
    const pkg = await englishPackage({ 'fig.png': PNG });
    const text = await rehostImages(
      '<img src="fig.png">',
      'statements/english',
      pkg,
      () => Promise.resolve('/media/$&$1.png'),
    );
    expect(text).toBe('<img src="/media/$&$1.png">');
    pkg.close();
  });
  it('scans in linear time on unterminated image syntax', async () => {
    const pkg = await englishPackage({ 'fig.png': PNG });
    const time = async (size: number) => {
      const started = process.hrtime.bigint();
      await rehostImages(
        `![image](${'![image]('.repeat(size)}\n<img ${'<img src="'.repeat(size)}`,
        'statements/english',
        pkg,
        saveEcho(),
      );
      return Number(process.hrtime.bigint() - started);
    };
    await time(2000);
    const small = await time(20000);
    const large = await time(80000);
    expect(large / small).toBeLessThan(10);
    pkg.close();
  });
});

describe('statement paths and validation', () => {
  it('refuses a statement path that leaves the package', async () => {
    const xml = `<problem><names><name language="english" value="S"/></names><statements><statement language="english" path="../evil/problem.tex" type="application/x-tex"/></statements></problem>`;
    const path = join(
      mkdtempSync(join(tmpdir(), 'qhhoj-polygon-')),
      'package.zip',
    );
    writeFileSync(path, buildZip([{ name: 'problem.xml', content: xml }]));
    const pkg = await PolygonPackage.open(path);
    await expect(
      parseStatements(await pkg.problemXml(), pkg, job(), identity, saveEcho()),
    ).rejects.toThrow(PolygonImportError);
    pkg.close();
  });
  it('accepts ordinary statements and rejects what an editor would reject', () => {
    expect(() =>
      assertStatementMarkdown('Fine $x$.', 'problem', 'statement'),
    ).not.toThrow();
    expect(() =>
      assertStatementMarkdown('a'.repeat(200_001), 'problem', 'statement'),
    ).toThrow(PolygonImportError);
    expect(() =>
      assertStatementMarkdown('say “hi”', 'problem', 'statement'),
    ).toThrow(/disallowed characters/);
    expect(() =>
      assertStatementMarkdown('<div>'.repeat(600), 'problem-full', 'statement'),
    ).toThrow(PolygonImportError);
  });
  it('fails the import, not the worker, when a converted statement is invalid', async () => {
    const pkg = await openPackage({
      tests: [{ input: '1', answer: '1' }],
      statements: [
        {
          language: 'english',
          name: 'Sum',
          properties: properties({ legend: 'say “hi”' }),
        },
      ],
    });
    await expect(
      parseStatements(await pkg.problemXml(), pkg, job(), identity, saveEcho()),
    ).rejects.toThrow(PolygonImportError);
    pkg.close();
  });
  it('rejects malformed problem-properties.json as an import error', async () => {
    const pkg = await openPackage({
      tests: [{ input: '1', answer: '1' }],
      statements: [
        { language: 'english', name: 'Sum', properties: { legend: 5 } },
      ],
    });
    await expect(
      parseStatements(await pkg.problemXml(), pkg, job(), identity, saveEcho()),
    ).rejects.toThrow(PolygonImportError);
    pkg.close();
  });
});
