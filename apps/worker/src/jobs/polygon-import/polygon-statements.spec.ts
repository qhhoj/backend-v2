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
  buildDescription,
  mainSolution,
  parseStatements,
  rehostImages,
  renderStatement,
  withImageBudget,
  withMainSolution,
} from './polygon-statements';
import { SVG_MAX_BYTES } from '@libs/problems';
import type { PolygonImportJob } from '@libs/problems';
import { buildZip, PNG, SVG_WITH_SCRIPT } from '@libs/problems/testing';

const identity = (tex: string) => Promise.resolve(tex);
const job = (overrides: Partial<PolygonImportJob> = {}): PolygonImportJob => ({
  requesterId: 'u',
  code: 'sum',
  mode: 'create',
  authors: [],
  curators: [],
  groupId: 'g',
  typeIds: ['t'],
  points: 800,
  isFullMarkup: false,
  mainStatementLanguage: null,
  statementLanguages: {},
  tutorialLanguage: null,
  ignoreZeroPointBatches: false,
  ignoreZeroPointCases: false,
  appendMainSolution: false,
  maxCases: 300,
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
    await pkg.close();
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
      parseStatements(await pkg.problemXml(), {
        pkg,
        job: job(),
        texToMarkdown: identity,
        saveImage: save,
      }),
    ).rejects.toThrow('invalid main statement language');
    await expect(
      parseStatements(await pkg.problemXml(), {
        pkg,
        job: job({ mainStatementLanguage: 'english' }),
        texToMarkdown: identity,
        saveImage: save,
      }),
    ).rejects.toThrow('invalid site language for vietnamese');
    const result = await parseStatements(await pkg.problemXml(), {
      pkg,
      job: job({
        mainStatementLanguage: 'english',
        statementLanguages: { vietnamese: 'vi' },
        tutorialLanguage: 'vietnamese',
      }),
      texToMarkdown: identity,
      saveImage: save,
    });
    expect(result.name).toBe('Sum');
    expect(result.description).toContain('Add $a$ and $b$.');
    expect(result.translations).toEqual([
      {
        language: 'vi',
        name: 'Tổng',
        description: expect.stringContaining('Cộng.') as string,
        descriptionHtml: expect.stringContaining('Cộng.') as string,
      },
    ]);
    expect(result.tutorial).toBe('Cộng lại.');
    await expect(
      parseStatements(await pkg.problemXml(), {
        pkg,
        job: job({
          mainStatementLanguage: 'english',
          statementLanguages: { vietnamese: 'vi' },
        }),
        texToMarkdown: identity,
        saveImage: save,
      }),
    ).rejects.toThrow('invalid main tutorial language');
    await pkg.close();
  });
  it('leaves out a statement mapped to skip, with its tutorial', async () => {
    const pkg = await openPackage({
      tests: [{ input: '1', answer: '1' }],
      statements: [
        {
          language: 'english',
          name: 'Sum',
          properties: properties({ tutorial: '' }),
        },
        {
          language: 'russian',
          name: 'Сумма',
          properties: properties({ legend: 'Сложить.', tutorial: 'Сложить.' }),
        },
      ],
    });
    const result = await parseStatements(await pkg.problemXml(), {
      pkg,
      job: job({
        mainStatementLanguage: 'english',
        statementLanguages: { russian: 'skip' },
      }),
      texToMarkdown: identity,
      saveImage: () => Promise.resolve('/media/images/x.png'),
    });
    expect(result.name).toBe('Sum');
    expect(result.translations).toEqual([]);
    expect(result.tutorial).toBe('');
    await pkg.close();
  });

  it('sanitizes imported statements even for a full-markup problem', async () => {
    // TeX math may hold `$` (`\\text{$a$}`), which splits the Markdown formula and leaves raw HTML outside it.
    const legend = '$\\text{$a$ $b$}<b onmouseover=alert(1)>x</b>$';
    const pkg = await openPackage({
      tests: [{ input: '1', answer: '1' }],
      statements: [
        {
          language: 'english',
          name: 'Sum',
          properties: properties({ legend }),
        },
      ],
    });
    const result = await parseStatements(await pkg.problemXml(), {
      pkg,
      job: job({ isFullMarkup: true, mainStatementLanguage: 'english' }),
      texToMarkdown: identity,
      saveImage: () => Promise.resolve('/media/images/x.png'),
    });
    expect(result.description).toContain('onmouseover');
    expect(result.descriptionHtml).not.toContain('onmouseover');
    await pkg.close();
  });
  it('stops saving images once an import passes its byte budget', async () => {
    const saved: number[] = [];
    const save = withImageBudget((bytes) => {
      saved.push(bytes.length);
      return Promise.resolve('/media/images/x.png');
    }, 10);
    await save(Buffer.alloc(6), 'a.png');
    await save(Buffer.alloc(4), 'b.png');
    await expect(save(Buffer.alloc(1), 'c.png')).rejects.toThrow(
      PolygonImportError,
    );
    expect(saved).toEqual([6, 4]);
  });
  it('requires a statement and problem-properties.json', async () => {
    const none = await openPackage({ tests: [{ input: '1', answer: '1' }] });
    await expect(
      parseStatements(await none.problemXml(), {
        pkg: none,
        job: job(),
        texToMarkdown: identity,
        saveImage: () => Promise.resolve(''),
      }),
    ).rejects.toThrow('statement not found');
    await none.close();
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
    await pkg.close();
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
    await pkg.close();
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
    await pkg.close();
  });
  it('rejects bytes that are not an image, whatever the file name says', async () => {
    const pkg = await englishPackage({
      'fig.png': Buffer.from('#!/bin/sh\necho hi'),
    });
    await expect(
      rehostImages('![image](fig.png)', 'statements/english', pkg, saveEcho()),
    ).rejects.toThrow('not a supported image');
    await pkg.close();
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
    await pkg.close();
  });
  it('rejects an image above the size cap', async () => {
    const pkg = await englishPackage({
      'fig.png': Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]),
    });
    await expect(
      rehostImages('![image](fig.png)', 'statements/english', pkg, saveEcho()),
    ).rejects.toThrow(PolygonImportError);
    await pkg.close();
  });
  it('enforces the SVG byte cap exactly', async () => {
    const svgOfSize = (bytes: number) => {
      const wrapper = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
      return Buffer.from(
        wrapper.replace(
          '</svg>',
          ' '.repeat(bytes - wrapper.length) + '</svg>',
        ),
      );
    };
    const rehost = async (svg: Buffer) => {
      const pkg = await englishPackage({ 'fig.svg': svg });
      try {
        return await rehostImages(
          '![image](fig.svg)',
          'statements/english',
          pkg,
          saveEcho(),
        );
      } finally {
        await pkg.close();
      }
    };
    await expect(rehost(svgOfSize(SVG_MAX_BYTES))).resolves.toContain(
      '/media/images/',
    );
    await expect(rehost(svgOfSize(SVG_MAX_BYTES + 1))).rejects.toThrow(
      'SVG is too large or too complex',
    );
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
    await pkg.close();
  });
  it('scans in linear time on unterminated image syntax', async () => {
    const pkg = await englishPackage({ 'fig.png': PNG });
    const time = async (size: number) => {
      const started = process.hrtime.bigint();
      await expect(
        rehostImages(
          `![image](${'![image]('.repeat(size)}\n<img ${'<img src="'.repeat(size)}`,
          'statements/english',
          pkg,
          saveEcho(),
        ),
      ).rejects.toThrow('unsupported image reference');
      return Number(process.hrtime.bigint() - started);
    };
    await time(2000);
    const small = await time(20000);
    const large = await time(80000);
    expect(large / small).toBeLessThan(10);
    await pkg.close();
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
      parseStatements(await pkg.problemXml(), {
        pkg,
        job: job(),
        texToMarkdown: identity,
        saveImage: saveEcho(),
      }),
    ).rejects.toThrow(PolygonImportError);
    await pkg.close();
  });
  it('accepts ordinary statements and rejects what an editor would reject', () => {
    expect(() =>
      renderStatement('Fine $x$.', 'problem', 'statement'),
    ).not.toThrow();
    expect(() =>
      renderStatement('a'.repeat(200_001), 'problem', 'statement'),
    ).toThrow(PolygonImportError);
    expect(() => renderStatement('say “hi”', 'problem', 'statement')).toThrow(
      /disallowed characters/,
    );
    expect(() =>
      renderStatement('<div>'.repeat(600), 'problem-full', 'statement'),
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
      parseStatements(await pkg.problemXml(), {
        pkg,
        job: job(),
        texToMarkdown: identity,
        saveImage: saveEcho(),
      }),
    ).rejects.toThrow(PolygonImportError);
    await pkg.close();
  });
  it('rejects malformed problem-properties.json as an import error', async () => {
    const pkg = await openPackage({
      tests: [{ input: '1', answer: '1' }],
      statements: [
        { language: 'english', name: 'Sum', properties: { legend: 5 } },
      ],
    });
    await expect(
      parseStatements(await pkg.problemXml(), {
        pkg,
        job: job(),
        texToMarkdown: identity,
        saveImage: saveEcho(),
      }),
    ).rejects.toThrow(PolygonImportError);
    await pkg.close();
  });
});

describe('hostile problem.xml values', () => {
  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])(
    'does not resolve the statement language %s through the prototype',
    async (language) => {
      const pkg = await openPackage({
        tests: [{ input: '1', answer: '1' }],
        statements: [
          { language: 'english', name: 'Sum', properties: properties() },
          { language, name: 'X', properties: properties() },
        ],
      });
      await expect(
        parseStatements(await pkg.problemXml(), {
          pkg,
          job: job({ mainStatementLanguage: 'english' }),
          texToMarkdown: identity,
          saveImage: saveEcho(),
        }),
      ).rejects.toThrow(`invalid site language for ${language}`);
      await pkg.close();
    },
  );
  it('refuses two statements in one language', async () => {
    const statement =
      '<statement language="english" path="statements/english/problem.tex" type="application/x-tex"/>';
    const xml = `<problem><names><name language="english" value="S"/></names><statements>${statement}${statement}</statements></problem>`;
    const path = join(
      mkdtempSync(join(tmpdir(), 'qhhoj-polygon-')),
      'package.zip',
    );
    writeFileSync(
      path,
      buildZip([
        { name: 'problem.xml', content: xml },
        {
          name: 'statements/english/problem-properties.json',
          content: JSON.stringify(properties()),
        },
      ]),
    );
    const pkg = await PolygonPackage.open(path);
    await expect(
      parseStatements(await pkg.problemXml(), {
        pkg,
        job: job(),
        texToMarkdown: identity,
        saveImage: saveEcho(),
      }),
    ).rejects.toThrow('two statements in the language english');
    await pkg.close();
  });
  it.each([
    ['empty', ''],
    ['too long', 'n'.repeat(101)],
    ['disallowed', 'say “hi”'],
  ])('rejects a %s statement name', async (_label, name) => {
    const pkg = await openPackage({
      tests: [{ input: '1', answer: '1' }],
      statements: [{ language: 'english', name, properties: properties() }],
    });
    await expect(
      parseStatements(await pkg.problemXml(), {
        pkg,
        job: job(),
        texToMarkdown: identity,
        saveImage: saveEcho(),
      }),
    ).rejects.toThrow(PolygonImportError);
    await pkg.close();
  });
});

describe('leftover image references', () => {
  it.each([
    ['a path above 500 characters', `![image](${'a'.repeat(501)}.png)`],
    ['mixed quotes', `<img src="fig.png'>`],
    ['an unquoted src', '<img src=fig.png>'],
    [
      'two src attributes',
      '<img src="fig.png" src="https://evil.example/x.png">',
    ],
    ['no src', '<img alt="x">'],
    ['an oversized tag', `<img alt="${'x'.repeat(1100)}" src="fig.png">`],
    ['an unterminated tag', '<img src="fig.png"'],
    ['an unterminated markdown image', '![image](fig.png'],
  ])('fails on %s instead of leaving it in the text', async (_label, text) => {
    const pkg = await englishPackage({ 'fig.png': PNG });
    await expect(
      rehostImages(text, 'statements/english', pkg, saveEcho()),
    ).rejects.toThrow('unsupported image reference');
    await pkg.close();
  });
  it('rewrites only the real src of a tag that also has data-src', async () => {
    const pkg = await englishPackage({ 'fig.png': PNG });
    const text = await rehostImages(
      '<img data-src="x" src="fig.png">',
      'statements/english',
      pkg,
      saveEcho(),
    );
    expect(text).toBe('<img data-src="x" src="/media/images/1">');
    await pkg.close();
  });
});

describe('mainSolution', () => {
  it('reads the trimmed source and its type', async () => {
    const pkg = await openPackage({
      tests: [{ input: '1', answer: '1' }],
      solution: {
        path: 'solutions/main.py',
        type: 'python.3',
        code: '\nprint(1)\n',
      },
    });
    expect(await mainSolution(await pkg.problemXml(), pkg)).toEqual({
      code: 'print(1)',
      sourceType: 'python.3',
    });
    await pkg.close();
  });
  it('fails when there is no main solution or its source is not in the package', async () => {
    const none = await openPackage({
      tests: [{ input: '1', answer: '1' }],
      solution: null,
    });
    await expect(mainSolution(await none.problemXml(), none)).rejects.toThrow(
      'main solution not found',
    );
    await none.close();
    const missing = await openPackage({
      tests: [{ input: '1', answer: '1' }],
      omitEntries: ['solutions/main.cpp'],
    });
    await expect(
      mainSolution(await missing.problemXml(), missing),
    ).rejects.toThrow(PolygonImportError);
    await missing.close();
  });
});

describe('parseStatements error order when a package has several faults', () => {
  const parseWith = async (
    pkg: PolygonPackage,
    overrides: Partial<PolygonImportJob> = {},
    saveImage = saveEcho(),
  ) =>
    parseStatements(await pkg.problemXml(), {
      pkg,
      job: job(overrides),
      texToMarkdown: identity,
      saveImage,
    });
  const statementNode = (language: string, folder = language) =>
    `<statement language="${language}" path="statements/${folder}/problem.tex" type="application/x-tex"/>`;
  /** A package whose problem.xml and files are written by hand, so any fault can be planted. */
  const handMadePackage = async (
    statementNodes: string[],
    names: Record<string, string>,
    files: Record<string, string>,
  ) => {
    const nameNodes = Object.entries(names)
      .map(
        ([language, value]) =>
          `<name language="${language}" value="${value}"/>`,
      )
      .join('');
    const xml = `<problem><names>${nameNodes}</names><statements>${statementNodes.join('')}</statements></problem>`;
    const path = join(
      mkdtempSync(join(tmpdir(), 'qhhoj-polygon-')),
      'package.zip',
    );
    writeFileSync(
      path,
      buildZip([
        { name: 'problem.xml', content: xml },
        ...Object.entries(files).map(([name, content]) => ({ name, content })),
      ]),
    );
    return PolygonPackage.open(path);
  };
  const goodProperties = JSON.stringify(properties());
  const fakeImage = Buffer.from('#!/bin/sh\necho hi');
  const withTranslation = (
    translation: Record<string, unknown>,
    main: Record<string, unknown> = properties(),
  ) =>
    openPackage({
      tests: [{ input: '1', answer: '1' }],
      statements: [
        { language: 'english', name: 'Sum', properties: main },
        {
          language: 'vietnamese',
          name: 'Tổng',
          ...{ properties: translation },
        },
      ],
    });

  it.each([
    [
      'no statement before an invalid main language',
      () => openPackage({ tests: [{ input: '1', answer: '1' }] }),
      { mainStatementLanguage: 'english' },
      'statement not found',
    ],
    [
      'two statements in one language before a missing properties file',
      () =>
        handMadePackage(
          [statementNode('english'), statementNode('english', 'copy')],
          { english: 'Sum' },
          { 'statements/english/problem-properties.json': goodProperties },
        ),
      {},
      'two statements in the language english',
    ],
    [
      'a missing properties file before an invalid name',
      () => handMadePackage([statementNode('english')], { english: '' }, {}),
      {},
      'problem-properties.json not found',
    ],
    [
      'an invalid name before a malformed properties file',
      () =>
        handMadePackage(
          [statementNode('english')],
          { english: '' },
          { 'statements/english/problem-properties.json': 'not json' },
        ),
      {},
      'statement name for english',
    ],
    [
      'a malformed properties file before an invalid main language',
      () => withTranslation({ legend: 5 }),
      {},
      'has an unexpected shape',
    ],
    [
      'an invalid image before an invalid statement text',
      () =>
        openPackage({
          tests: [{ input: '1', answer: '1' }],
          statements: [
            {
              language: 'english',
              name: 'Sum',
              properties: properties({ legend: '![image](fig.png) say “hi”' }),
              images: { 'fig.png': fakeImage },
            },
          ],
        }),
      {},
      'not a supported image',
    ],
    [
      'an invalid statement text before an invalid site language',
      () => withTranslation(properties({ legend: 'say “hi”' })),
      { mainStatementLanguage: 'english' },
      'disallowed characters',
    ],
    [
      'an invalid main language before an invalid tutorial language',
      () =>
        withTranslation(
          properties({ tutorial: 'Cộng lại.' }),
          properties({ tutorial: 'Add them.' }),
        ),
      {},
      'invalid main statement language',
    ],
    [
      'an invalid site language before an invalid tutorial language',
      () =>
        withTranslation(
          properties({ tutorial: 'Cộng lại.' }),
          properties({ tutorial: 'Add them.' }),
        ),
      { mainStatementLanguage: 'english' },
      'invalid site language for vietnamese',
    ],
  ])('reports %s', async (_label, makePackage, overrides, message) => {
    const pkg = await makePackage();
    await expect(parseWith(pkg, overrides)).rejects.toThrow(message);
    await pkg.close();
  });

  it('refuses two statements mapped to one site language', async () => {
    const pkg = await handMadePackage(
      ['english', 'vietnamese', 'french'].map((language) =>
        statementNode(language),
      ),
      { english: 'Sum', vietnamese: 'Tổng', french: 'Somme' },
      Object.fromEntries(
        ['english', 'vietnamese', 'french'].map((language) => [
          `statements/${language}/problem-properties.json`,
          goodProperties,
        ]),
      ),
    );
    await expect(
      parseWith(pkg, {
        mainStatementLanguage: 'english',
        statementLanguages: { vietnamese: 'vi', french: 'vi' },
      }),
    ).rejects.toThrow('two statements map to the site language vi');
    await pkg.close();
  });

  it('saves no image when the main statement language is invalid', async () => {
    const pkg = await openPackage({
      tests: [{ input: '1', answer: '1' }],
      statements: [
        {
          language: 'english',
          name: 'Sum',
          properties: properties({ legend: '![image](fig.png)' }),
          images: { 'fig.png': PNG },
        },
        { language: 'vietnamese', name: 'Tổng', properties: properties() },
      ],
    });
    const saved: string[] = [];
    const save = (_bytes: Buffer, name: string) => {
      saved.push(name);
      return Promise.resolve('/media/images/1.png');
    };
    await expect(parseWith(pkg, {}, save)).rejects.toThrow(
      'invalid main statement language',
    );
    expect(saved).toEqual([]);
    await pkg.close();
  });
});

describe('problem-properties.json shape', () => {
  const parseOne = async (propertiesJson: Record<string, unknown>) => {
    const pkg = await openPackage({
      tests: [{ input: '1', answer: '1' }],
      statements: [
        { language: 'english', name: 'Sum', properties: propertiesJson },
      ],
    });
    try {
      return await parseStatements(await pkg.problemXml(), {
        pkg,
        job: job(),
        texToMarkdown: identity,
        saveImage: saveEcho(),
      });
    } finally {
      await pkg.close();
    }
  };
  const textKeys = [
    'legend',
    'input',
    'output',
    'notes',
    'interaction',
    'scoring',
    'tutorial',
  ];

  it.each(textKeys)('rejects a non-string %s', async (key) => {
    await expect(parseOne(properties({ [key]: 5 }))).rejects.toThrow(
      'unexpected shape',
    );
  });
  it.each(['interaction', 'scoring', 'tutorial'])(
    'accepts a null or missing optional %s',
    async (key) => {
      await expect(
        parseOne(properties({ [key]: null })),
      ).resolves.toBeDefined();
      await expect(
        parseOne(properties({ [key]: undefined })),
      ).resolves.toBeDefined();
    },
  );
  it.each([
    ['not an array', 'x'],
    ['missing', undefined],
    ['an entry that is null', [null]],
    ['an entry without output', [{ input: '1' }]],
    ['an entry with a non-string input', [{ input: 1, output: '1' }]],
    ['an entry with a non-string output', [{ input: '1', output: 1 }]],
  ])('rejects sampleTests %s', async (_label, sampleTests) => {
    await expect(parseOne(properties({ sampleTests }))).rejects.toThrow(
      'unexpected shape',
    );
  });
});
