import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { join } from 'node:path';
import { buildZip } from './testing';
import { listZipEntries, ZipArchive, ZipError } from './zip-archive';

type Entries = Parameters<typeof buildZip>[0];

describe('ZipArchive', () => {
  const directory = mkdtempSync(join(tmpdir(), 'qhhoj-zip-'));
  afterAll(() => rmSync(directory, { recursive: true, force: true }));
  const open = (entries: Entries) => ZipArchive.fromBuffer(buildZip(entries));
  const rejects = (
    entries: Entries,
    message: string | RegExp | Error | (new (...args: never[]) => Error),
  ) => expect(open(entries)).rejects.toThrow(message);
  /** Descriptors of this process that point at or under `path`; unaffected by unrelated fds. */
  const descriptorsOpenOn = (path: string) =>
    readdirSync('/proc/self/fd').filter((fd) => {
      try {
        return readlinkSync(`/proc/self/fd/${fd}`).startsWith(path);
      } catch {
        return false; // closed since the listing (the readdir fd itself)
      }
    });
  const collect = async (stream: AsyncIterable<unknown>) => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  };
  const timeOf = async (action: () => Promise<unknown>) => {
    const started = performance.now();
    await action();
    return performance.now() - started;
  };

  it('lists file entries, skips directories, reads and streams members', async () => {
    const zip = await open([
      { name: 'tests/' },
      { name: 'tests/01.inp', content: '1 2\n' },
      { name: 'tests/01.out', content: '3\n' },
    ]);
    expect(zip.names()).toEqual(['tests/01.inp', 'tests/01.out']);
    expect(zip.has('tests/')).toBe(false);
    expect(zip.sizeOf('tests/01.inp')).toBe(4);
    expect((await zip.read('tests/01.out')).toString()).toBe('3\n');
    expect((await collect(await zip.stream('tests/01.inp'))).toString()).toBe(
      '1 2\n',
    );
    await expect(zip.read('nope')).rejects.toThrow(
      new ZipError('No such file in the archive: nope', 'zip_entry_missing'),
    );
    await zip.close();
  });

  it.each([
    ['traversal', [{ name: '../evil' }]],
    ['nested traversal', [{ name: 'a/../../evil' }]],
    ['absolute', [{ name: '/etc/passwd' }]],
    ['backslash', [{ name: 'a\\b' }]],
    ['control characters', [{ name: 'a\u0001b' }]],
    ['an empty name', [{ name: '' }]],
    ['a dot name', [{ name: '.' }]],
    ['a leading dot segment', [{ name: './a' }]],
    ['an empty segment', [{ name: 'a//b' }]],
    ['a middle dot segment', [{ name: 'a/./b' }]],
    ['duplicate names', [{ name: 'a' }, { name: 'a' }]],
    [
      'symlinks',
      [{ name: 'link', symlink: true, content: '../../etc/passwd' }],
    ],
    ['encrypted members', [{ name: 'a', encrypted: true }]],
    ['unsupported compression', [{ name: 'a', methodNumber: 12 }]],
    ['lying stored sizes', [{ name: 'a', content: 'abcd', declaredSize: 2 }]],
  ])('refuses %s', (_label, entries) => rejects(entries, ZipError));

  it('echoes names without control characters and cut to 100 characters', async () => {
    const message = async (name: string, symlink = false) =>
      (
        (await open([{ name, symlink }]).catch(
          (caught: Error) => caught,
        )) as Error
      ).message;
    expect(await message(`${'x'.repeat(150)}`, true)).toBe(
      `Symbolic links are not allowed: ${'x'.repeat(100)}`,
    );
    const fromYauzl = await message(`\u0007${'x'.repeat(150)}/../y`);
    expect(fromYauzl.includes('\u0007')).toBe(false);
    expect(fromYauzl.length).toBeLessThan(200);
  });

  it('refuses a corrupt archive with a plain message', () =>
    expect(ZipArchive.fromBuffer(Buffer.from('not a zip'))).rejects.toThrow(
      new ZipError('The archive is not a valid zip file.', 'zip_invalid'),
    ));

  it('refuses an end record whose count hides central directory records', async () => {
    const three = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];
    const inconsistent = new ZipError(
      'Archive central directory is inconsistent.',
      'zip_inconsistent',
    );
    await expect(
      ZipArchive.fromBuffer(buildZip(three, { declaredEntryCount: 1 })),
    ).rejects.toThrow(inconsistent);
    await expect(
      ZipArchive.fromBuffer(
        buildZip([{ name: 'a' }], { declaredEntryCount: 0 }),
      ),
    ).rejects.toThrow(inconsistent);
    await expect(
      ZipArchive.fromBuffer(buildZip(three, { declaredEntryCount: 3 })),
    ).resolves.toBeInstanceOf(ZipArchive);
  });

  it('accepts zip64 archives and refuses a zip64 count that hides records', async () => {
    const three = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];
    const zip = await ZipArchive.fromBuffer(buildZip(three, { zip64: true }));
    expect(zip.names()).toEqual(['a', 'b', 'c']);
    await zip.close();
    await expect(
      ZipArchive.fromBuffer(
        buildZip(three, { zip64: true, declaredEntryCount: 1 }),
      ),
    ).rejects.toThrow(
      new ZipError(
        'Archive central directory is inconsistent.',
        'zip_inconsistent',
      ),
    );
    const path = join(directory, 'zip64.zip');
    writeFileSync(path, buildZip(three, { zip64: true }));
    await expect(listZipEntries(path)).resolves.toEqual(['a', 'b', 'c']);
    writeFileSync(
      path,
      buildZip(three, { zip64: true, declaredEntryCount: 1 }),
    );
    await expect(listZipEntries(path)).rejects.toThrow(ZipError);
  });

  it('refuses crafted 64-bit offsets on the disk path, promptly, without leaks or uncaught errors', async () => {
    const three = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];
    const crafted = {
      'locator 2^53': { zip64: true, zip64RecordOffset: 2n ** 53n },
      'locator 2^64-1': { zip64: true, zip64RecordOffset: 2n ** 64n - 1n },
      'central directory 2^53': { zip64: true, zip64CentralOffset: 2n ** 53n },
    };
    const uncaught: Error[] = [];
    const record = (error: Error) => uncaught.push(error);
    process.on('uncaughtException', record);
    try {
      for (const [label, options] of Object.entries(crafted)) {
        const path = join(directory, `crafted-${label.replace(/\W/g, '')}.zip`);
        writeFileSync(path, buildZip(three, options));
        const duration = await timeOf(() =>
          expect(ZipArchive.open(path)).rejects.toThrow(ZipError),
        );
        expect(duration).toBeLessThan(1000);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      process.off('uncaughtException', record);
    }
    expect(uncaught).toEqual([]);
    expect(descriptorsOpenOn(directory)).toEqual([]);
  });

  it('refuses entries that point outside the archive', async () => {
    await rejects([{ name: 'a', localHeaderOffset: 1_000_000 }], ZipError);
    await rejects(
      [
        {
          name: 'a',
          content: 'x',
          method: 'deflate',
          declaredCompressedSize: 1_000_000,
        },
      ],
      ZipError,
    );
  });

  const hasZipBinary = (() => {
    try {
      execFileSync('zip', ['-v'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();
  (hasZipBinary ? it : it.skip)(
    'accepts what Info-ZIP writes when streaming from stdin',
    async () => {
      const path = join(directory, 'streamed.zip');
      execFileSync('zip', [path, '-'], {
        input: randomBytes(100 * 1024),
        stdio: ['pipe', 'ignore', 'ignore'],
      });
      expect(
        readFileSync(path).includes(Buffer.from([0x50, 0x4b, 0x06, 0x07])),
      ).toBe(true);
      expect(await listZipEntries(path)).toEqual(['-']);
    },
  );

  it('stops at 25000 entries and 2 GiB declared', async () => {
    const gigabyte = 1024 ** 3;
    const megabyte = randomBytes(1024 * 1024);
    await rejects(
      [
        {
          name: 'a',
          content: megabyte,
          declaredSize: gigabyte,
          method: 'deflate',
        },
        {
          name: 'b',
          content: megabyte,
          declaredSize: gigabyte,
          method: 'deflate',
        },
        { name: 'c', content: 'x' },
      ],
      'The archive is too large',
    );
    await rejects(
      [{ name: 'tiny', content: 'x', declaredSize: 5000, method: 'deflate' }],
      'impossible compression ratio',
    );
    const files = Array.from({ length: 25001 }, (_item, index) => ({
      name: `f${index}`,
    }));
    await rejects(files, 'The archive has too many files');
  });

  it('counts directory records against the entry limit too', async () => {
    const directories = Array.from({ length: 25001 }, (_item, index) => ({
      name: `d${index}/`,
    }));
    const duration = await timeOf(() =>
      rejects(directories, 'The archive has too many files'),
    );
    expect(duration).toBeLessThan(5000);
    const allowed = directories.slice(0, 25000);
    await expect(open(allowed)).resolves.toBeInstanceOf(ZipArchive);
  });

  it('refuses to read a member above the entry cap', async () => {
    const zip = await open([
      {
        name: 'big',
        content: randomBytes(600 * 1024),
        declaredSize: 600 * 1024 ** 2,
        method: 'deflate',
      },
    ]);
    await expect(zip.read('big')).rejects.toThrow(
      new ZipError('big is too large to read', 'zip_entry_too_large'),
    );
    await zip.close();
  });

  it('rejects members whose inflated size differs from the declared one', async () => {
    const zip = await open([
      {
        name: 'longer',
        content: Buffer.alloc(4096),
        declaredSize: 1024,
        method: 'deflate',
      },
      {
        name: 'shorter',
        content: Buffer.alloc(1024),
        declaredSize: 2048,
        method: 'deflate',
      },
    ]);
    await expect(zip.read('longer')).rejects.toThrow(ZipError);
    await expect(zip.read('shorter')).rejects.toThrow(ZipError);
    await zip.close();
  });

  it('reports corrupt, truncated and wrongly checksummed members as ZipError', async () => {
    const original = randomBytes(10_000);
    const zip = await open([
      {
        name: 'corrupt',
        content: 'hello',
        method: 'deflate',
        data: Buffer.from([0xff, 0xff, 0xff, 0xff]),
      },
      {
        name: 'truncated',
        content: original,
        method: 'deflate',
        data: deflateRawSync(original).subarray(0, 5000),
      },
      { name: 'checksum', content: 'abcd', checksum: 1234 },
    ]);
    for (const name of zip.names())
      await expect(zip.read(name)).rejects.toThrow(ZipError);
    await zip.close();
  });

  it('aborts a deflate bomb that declares a small size without leaking a descriptor', async () => {
    const zip = await open([
      {
        name: 'bomb',
        content: Buffer.alloc(64 * 1024 ** 2),
        declaredSize: 1024,
        method: 'deflate',
      },
    ]);
    let received = 0;
    await expect(
      (async () => {
        for await (const chunk of await zip.stream('bomb'))
          received += (chunk as Buffer).length;
      })(),
    ).rejects.toThrow(ZipError);
    expect(received).toBeLessThanOrEqual(1024);
    await zip.close();
    expect(descriptorsOpenOn(directory)).toEqual([]);
  });

  /** Makes every file close take one extra turn of the event loop, as it does under load, so a close that is not awaited is caught every run. */
  const slowCloses = () => {
    const realOpen = fsPromises.open;
    const opens = jest.fn(async (...args: Parameters<typeof realOpen>) => {
      const handle = await realOpen(...args);
      const realClose = handle.close.bind(handle);
      handle.close = () =>
        new Promise((resolve) => setImmediate(resolve)).then(realClose);
      return handle;
    });
    // fs/promises exports are writable but not configurable, so jest.spyOn cannot wrap them.
    (fsPromises as { open: unknown }).open = opens;
    return {
      opens,
      restore: () => ((fsPromises as { open: unknown }).open = realOpen),
    };
  };

  it('lists no entry the judge cannot open as a case file, but accepts the archive', async () => {
    const path = join(directory, 'dotted.zip');
    writeFileSync(
      path,
      buildZip([
        { name: '.tests/1.in', content: '1' },
        { name: '__MACOSX/._1.in', content: 'x' },
        { name: 'tests/.hidden/2.in', content: '2' },
        { name: '.DS_Store', content: 'x' },
        { name: 'tests/1.in', content: '1' },
      ]),
    );
    await expect(listZipEntries(path)).resolves.toEqual(['tests/1.in']);
  });

  it('opens from disk and has closed the file by the time any open, listing or close settles', async () => {
    const good = join(directory, 'good.zip');
    writeFileSync(good, buildZip([{ name: 'a', content: 'x' }]));
    const bad = join(directory, 'bad.zip');
    writeFileSync(bad, buildZip([{ name: '../evil' }]));
    const garbage = join(directory, 'garbage.zip');
    writeFileSync(garbage, 'not a zip');
    const lying = join(directory, 'lying.zip');
    writeFileSync(
      lying,
      buildZip([
        {
          name: 'a',
          content: Buffer.alloc(64),
          declaredSize: 8,
          method: 'deflate',
        },
      ]),
    );
    const missing = join(directory, 'missing.zip');
    const slow = slowCloses();
    try {
      for (const path of [bad, garbage, missing]) {
        await expect(ZipArchive.open(path)).rejects.toThrow(ZipError);
        expect(descriptorsOpenOn(directory)).toEqual([]);
        await expect(listZipEntries(path)).rejects.toThrow(ZipError);
        expect(descriptorsOpenOn(directory)).toEqual([]);
      }
      const zip = await ZipArchive.open(lying);
      await expect(zip.read('a')).rejects.toThrow(ZipError);
      await zip.close();
      expect(descriptorsOpenOn(directory)).toEqual([]);
      await expect(listZipEntries(good)).resolves.toEqual(['a']);
      expect(descriptorsOpenOn(directory)).toEqual([]);
      expect(slow.opens).toHaveBeenCalled();
    } finally {
      slow.restore();
    }
  });
});
