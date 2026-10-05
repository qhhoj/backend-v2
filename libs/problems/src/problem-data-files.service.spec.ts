import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { Env } from '@libs/common';
import { ProblemDataFilesService } from './problem-data-files.service';

describe('ProblemDataFilesService', () => {
  const root = mkdtempSync(join(tmpdir(), 'qhhoj-problem-data-'));
  const files = new ProblemDataFilesService({ problemDataRoot: root } as Env);
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('writes init.yml atomically under <root>/<code>/ and reads it back', async () => {
    await files.writeInit('sum', 'archive: tests.zip\n');
    expect(readFileSync(join(root, 'sum', 'init.yml'), 'utf8')).toBe(
      'archive: tests.zip\n',
    );
    expect(readdirSync(join(root, 'sum'))).toEqual(['init.yml']);
    expect(await files.readInit('sum')).toBe('archive: tests.zip\n');
    await files.removeInit('sum');
    expect(await files.readInit('sum')).toBeNull();
    await files.removeInit('sum');
  });
  it('writes buffers and streams, reports existence', async () => {
    await files.writeFile('sum', 'checker.cpp', Buffer.from('int main(){}'));
    await files.writeFile(
      'sum',
      'tests.zip',
      Readable.from([Buffer.from('PK')]),
    );
    expect(await files.exists('sum')).toBe(true);
    expect(await files.exists('sum', 'tests.zip')).toBe(true);
    expect(await files.exists('sum', 'missing.zip')).toBe(false);
    expect(await files.exists('nope')).toBe(false);
    await files.removeFile('sum', 'checker.cpp');
    expect(await files.exists('sum', 'checker.cpp')).toBe(false);
  });
  it.each(['../x', 'a/b', '.hidden', 'a..b', '', 'x\0y'])(
    'refuses the file name %j',
    (name) =>
      expect(() => files.pathOf('sum', name)).toThrow('Unsafe data file name'),
  );
  it('refuses codes that escape the root', () => {
    expect(() => files.directoryOf('../etc')).toThrow(
      'Path escapes PROBLEM_DATA_ROOT',
    );
    expect(() => files.directoryOf('')).toThrow(
      'Path escapes PROBLEM_DATA_ROOT',
    );
  });
  it('renames a directory, refuses an existing target and ignores a missing source', async () => {
    await files.writeInit('old', 'x: 1\n');
    await files.writeInit('taken', 'x: 2\n');
    await expect(files.rename('old', 'taken')).rejects.toThrow(
      'Data directory already exists: taken',
    );
    expect(existsSync(join(root, 'old', 'init.yml'))).toBe(true);
    await files.rename('old', 'fresh');
    expect(existsSync(join(root, 'old'))).toBe(false);
    expect(await files.readInit('fresh')).toBe('x: 1\n');
    await files.rename('ghost', 'other');
    expect(existsSync(join(root, 'other'))).toBe(false);
  });
  it('stages an upload inside the problem directory and commits it by rename', async () => {
    const staged = await files.stageUpload('sum');
    expect(staged.startsWith(join(root, 'sum') + '/upload-')).toBe(true);
    writeFileSync(staged, 'zip bytes');
    await files.commitUpload('sum', staged, 'data.zip');
    expect(readFileSync(join(root, 'sum', 'data.zip'), 'utf8')).toBe(
      'zip bytes',
    );
    expect(existsSync(staged)).toBe(false);
  });
  it('keeps Polygon packages under .imports and refuses unsafe job ids', async () => {
    expect(
      await files.importPackagePath('0192b0e0-0000-7000-8000-000000000001'),
    ).toBe(join(root, '.imports', '0192b0e0-0000-7000-8000-000000000001.zip'));
    expect(existsSync(join(root, '.imports'))).toBe(true);
    await expect(files.importPackagePath('../x')).rejects.toThrow(
      'Unsafe data file name',
    );
  });
});
