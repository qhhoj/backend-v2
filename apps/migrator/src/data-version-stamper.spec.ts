import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DATA_VERSION_FILE } from '@libs/problems';
import { dataVersionFiles, stampDataVersions } from './data-version-stamper';

describe('stampDataVersions', () => {
  let root: string;
  let options: { files: ReturnType<typeof dataVersionFiles>; dryRun: boolean };
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'stamp-'));
    options = { files: dataVersionFiles(root), dryRun: false };
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  const stamp = (code: string) =>
    readFile(join(root, code, DATA_VERSION_FILE), 'utf8');
  const problemDir = (code: string) =>
    mkdir(join(root, code), { recursive: true });

  it('writes missing stamps as the decimal version and a newline', async () => {
    await problemDir('aplusb');
    const summary = await stampDataVersions(
      [{ code: 'aplusb', dataVersion: 7 }],
      options,
    );
    expect(await stamp('aplusb')).toBe('7\n');
    expect(summary).toEqual({
      written: 1,
      kept: 0,
      missingDirectory: 0,
      invalidCode: 0,
    });
  });

  it('raises a lower stamp and never lowers a higher one', async () => {
    await problemDir('low');
    await problemDir('high');
    await writeFile(join(root, 'low', DATA_VERSION_FILE), '2\n');
    await writeFile(join(root, 'high', DATA_VERSION_FILE), '9\n');
    const summary = await stampDataVersions(
      [
        { code: 'low', dataVersion: 5 },
        { code: 'high', dataVersion: 5 },
      ],
      options,
    );
    expect(await stamp('low')).toBe('5\n');
    expect(await stamp('high')).toBe('9\n');
    expect(summary).toMatchObject({ written: 1, kept: 1 });
  });

  it('is idempotent', async () => {
    await problemDir('p');
    await stampDataVersions([{ code: 'p', dataVersion: 3 }], options);
    const again = await stampDataVersions(
      [{ code: 'p', dataVersion: 3 }],
      options,
    );
    expect(again).toEqual({
      written: 0,
      kept: 1,
      missingDirectory: 0,
      invalidCode: 0,
    });
  });

  it('counts missing directories and bad codes without creating anything', async () => {
    const summary = await stampDataVersions(
      [
        { code: 'gone', dataVersion: 1 },
        { code: '../etc', dataVersion: 1 },
        { code: 'UPPER', dataVersion: 1 },
      ],
      options,
    );
    expect(summary).toEqual({
      written: 0,
      kept: 0,
      missingDirectory: 1,
      invalidCode: 2,
    });
    await expect(
      readFile(join(root, 'gone', DATA_VERSION_FILE)),
    ).rejects.toThrow();
  });

  it('dry run counts but writes nothing', async () => {
    await problemDir('p');
    const summary = await stampDataVersions([{ code: 'p', dataVersion: 4 }], {
      ...options,
      dryRun: true,
    });
    expect(summary.written).toBe(1);
    await expect(stamp('p')).rejects.toThrow();
  });

  it('refuses a problem directory that is a symlink out of the root', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'outside-'));
    await symlink(outside, join(root, 'evil'));
    await expect(
      stampDataVersions([{ code: 'evil', dataVersion: 1 }], options),
    ).rejects.toThrow(/escapes/);
    await rm(outside, { recursive: true, force: true });
  });

  it('a garbage stamp is replaced', async () => {
    await problemDir('p');
    await writeFile(join(root, 'p', DATA_VERSION_FILE), 'seven');
    await stampDataVersions([{ code: 'p', dataVersion: 2 }], options);
    expect(await stamp('p')).toBe('2\n');
  });
});
