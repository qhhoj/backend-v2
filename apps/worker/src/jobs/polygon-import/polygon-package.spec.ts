import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ZipArchive } from '@libs/problems';
import { buildZip } from '@libs/problems/testing';
import {
  buildPolygonPackage,
  properties,
} from '../../../test/polygon-fixtures';
import { PolygonImportError } from './polygon-import.error';
import {
  IMAGE_MAX_BYTES,
  PolygonPackage,
  repackTests,
  resolveMemberPath,
  SOURCE_MAX_BYTES,
} from './polygon-package';
import type { PlannedTest } from './polygon-tests';

const written = (content: Buffer) => {
  const path = join(
    mkdtempSync(join(tmpdir(), 'qhhoj-polygon-')),
    'package.zip',
  );
  writeFileSync(path, content);
  return path;
};
const opened = (content: Buffer) => PolygonPackage.open(written(content));
const oneTest = { tests: [{ input: '1', answer: '1' }] };
const planned = (inputPath: string, answerPath: string): PlannedTest => ({
  index: 0,
  inputPath,
  answerPath,
  inputName: '01.inp',
  outputName: '01.out',
});
const drain = async (stream: NodeJS.ReadableStream) => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
};

describe('PolygonPackage', () => {
  it('requires problem.xml and reads members under a declared-size cap', async () => {
    await expect(
      opened(buildPolygonPackage({ ...oneTest, withProblemXml: false })),
    ).rejects.toThrow(new PolygonImportError('problem.xml not found'));
    const pkg = await opened(
      buildPolygonPackage({
        ...oneTest,
        statements: [
          {
            language: 'english',
            name: 'Sum',
            properties: properties(),
            images: { 'huge.png': Buffer.alloc(IMAGE_MAX_BYTES + 1) },
          },
        ],
        files: { 'files/big.cpp': Buffer.alloc(SOURCE_MAX_BYTES + 1) },
      }),
    );
    expect((await pkg.problemXml()).name).toBe('problem');
    expect(await pkg.readText('tests/01', SOURCE_MAX_BYTES)).toBe('1');
    await expect(
      pkg.read('statements/english/huge.png', IMAGE_MAX_BYTES),
    ).rejects.toThrow(
      `statements/english/huge.png is larger than ${IMAGE_MAX_BYTES} bytes`,
    );
    await expect(pkg.read('files/big.cpp', SOURCE_MAX_BYTES)).rejects.toThrow(
      'files/big.cpp is larger than',
    );
    await expect(pkg.read('missing', SOURCE_MAX_BYTES)).rejects.toThrow(
      'missing not found in the package',
    );
    pkg.close();
  });

  it('checks the declared size before inflating and still stops a lying member', async () => {
    const bomb = Buffer.alloc(100_000, 'a');
    const pkg = await opened(
      buildZip([
        { name: 'problem.xml', content: '<problem/>' },
        { name: 'honest-large', content: bomb, method: 'deflate' },
        { name: 'liar', content: bomb, method: 'deflate', declaredSize: 10 },
      ]),
    );
    await expect(pkg.read('honest-large', 1000)).rejects.toThrow(
      'honest-large is larger than 1000 bytes',
    );
    await expect(pkg.read('liar', 1000)).rejects.toThrow(PolygonImportError);
    pkg.close();
  });

  it('turns an unreadable archive and an oversized or hostile problem.xml into import errors', async () => {
    await expect(opened(Buffer.from('not a zip'))).rejects.toThrow(
      PolygonImportError,
    );
    const hostile = await opened(
      buildZip([
        {
          name: 'problem.xml',
          content: '<!DOCTYPE a [<!ENTITY x "y">]><problem/>',
        },
      ]),
    );
    await expect(hostile.problemXml()).rejects.toThrow(
      new PolygonImportError('problem.xml must not declare a DOCTYPE'),
    );
    hostile.close();
  });

  it('never resolves member names outside the package namespace', async () => {
    const pkg = await opened(buildPolygonPackage(oneTest));
    expect(pkg.has('./files/check.cpp')).toBe(true);
    for (const name of [
      '../problem.xml',
      'files/../problem.xml',
      '/problem.xml',
      'files\\check.cpp',
      'files/check.cpp\0',
      '',
    ]) {
      expect(pkg.has(name)).toBe(false);
      await expect(pkg.read(name, SOURCE_MAX_BYTES)).rejects.toThrow(
        PolygonImportError,
      );
      await expect(pkg.stream(name)).rejects.toThrow(PolygonImportError);
      expect(() => pkg.sizeOf(name)).toThrow(PolygonImportError);
    }
    pkg.close();
  });
});

describe('resolveMemberPath', () => {
  it('normalises package paths and rejects escapes', () => {
    expect(resolveMemberPath('./files//check.cpp')).toBe('files/check.cpp');
    for (const path of ['..', '../a', 'a/../b', '/a', 'a\\b', 'a\0b', '', '.'])
      expect(() => resolveMemberPath(path)).toThrow(PolygonImportError);
  });
  it('keeps statement-relative paths inside the statement folder', () => {
    const folder = 'statements/english';
    expect(resolveMemberPath('fig.png', folder)).toBe(
      'statements/english/fig.png',
    );
    expect(resolveMemberPath('img/fig.png', folder)).toBe(
      'statements/english/img/fig.png',
    );
    // Inside the package but outside the statement folder.
    for (const path of ['../../problem.xml', '../french/fig.png', '/fig.png'])
      expect(() => resolveMemberPath(path, folder)).toThrow(PolygonImportError);
  });
});

describe('repackTests', () => {
  it('streams tests under the legacy names', async () => {
    const pkg = await opened(
      buildPolygonPackage({
        tests: [
          { input: '1 2\n', answer: '3\n' },
          { input: '4 5\n', answer: '9\n' },
        ],
      }),
    );
    const repacked = await ZipArchive.fromBuffer(
      await drain(
        repackTests(pkg, [
          planned('tests/01', 'tests/01.a'),
          {
            ...planned('tests/02', 'tests/02.a'),
            inputName: '02.inp',
            outputName: '02.out',
          },
        ]),
      ),
    );
    expect(repacked.names().sort()).toEqual([
      '01.inp',
      '01.out',
      '02.inp',
      '02.out',
    ]);
    expect((await repacked.read('02.inp')).toString()).toBe('4 5\n');
    expect((await repacked.read('01.out')).toString()).toBe('3\n');
    repacked.close();
    pkg.close();
  });

  it.each([
    ['a missing member', 'tests/09', 'not full package: tests/09 is missing'],
    [
      'a path escaping the package',
      '../x',
      'not full package: ../x is missing',
    ],
  ])('fails on %s', async (_label, inputPath, message) => {
    const pkg = await opened(buildPolygonPackage(oneTest));
    await expect(
      drain(repackTests(pkg, [planned(inputPath, 'tests/01.a')])),
    ).rejects.toThrow(new PolygonImportError(message));
    pkg.close();
  });
});
