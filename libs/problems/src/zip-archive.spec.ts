import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { crc32, deflateRawSync } from 'node:zlib';
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
  const openFileDescriptors = () => readdirSync('/proc/self/fd').length;
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
      new ZipError('No such file in the archive: nope'),
    );
    zip.close();
  });

  it('keeps non-ASCII names intact', async () => {
    const zip = await open([{ name: 'bài/đề.inp', content: 'x' }]);
    expect(zip.names()).toEqual(['bài/đề.inp']);
    zip.close();
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

  it('refuses a Unicode path extra that renames the entry', () => {
    const unicodeName = Buffer.from('b.txt');
    const field = Buffer.alloc(4 + 5 + unicodeName.length);
    field.writeUInt16LE(0x7075, 0);
    field.writeUInt16LE(5 + unicodeName.length, 2);
    field.writeUInt8(1, 4);
    field.writeUInt32LE(crc32(Buffer.from('a.txt')), 5);
    unicodeName.copy(field, 9);
    return rejects([{ name: 'a.txt', centralExtra: field }], ZipError);
  });

  it('refuses a corrupt archive with a plain message', () =>
    expect(ZipArchive.fromBuffer(Buffer.from('not a zip'))).rejects.toThrow(
      new ZipError('The archive is not a valid zip file.'),
    ));

  it('refuses an end record whose count hides central directory records', async () => {
    const three = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];
    const inconsistent = new ZipError(
      'Archive central directory is inconsistent.',
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
      new ZipError('big is too large to read'),
    );
    zip.close();
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
    zip.close();
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
    zip.close();
  });

  it('stops inflating a lying member before handing out the excess', async () => {
    const zip = await open([
      {
        name: 'longer',
        content: Buffer.alloc(8 * 1024 * 1024),
        declaredSize: 1024,
        method: 'deflate',
      },
    ]);
    let received = 0;
    await expect(
      (async () => {
        for await (const chunk of await zip.stream('longer'))
          received += (chunk as Buffer).length;
      })(),
    ).rejects.toThrow(ZipError);
    expect(received).toBeLessThanOrEqual(1024);
    zip.close();
  });

  it('aborts a deflate bomb that declares a small size without leaking a descriptor', async () => {
    const before = openFileDescriptors();
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
    zip.close();
    expect(openFileDescriptors()).toBe(before);
  });

  it('opens from disk and leaks no file descriptor on any failing open', async () => {
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
    const before = openFileDescriptors();
    for (let round = 0; round < 200; round++) {
      await expect(ZipArchive.open(bad)).rejects.toThrow(ZipError);
      await expect(ZipArchive.open(garbage)).rejects.toThrow(ZipError);
      await expect(ZipArchive.open(missing)).rejects.toThrow(ZipError);
      await expect(listZipEntries(bad)).rejects.toThrow(ZipError);
      const zip = await ZipArchive.open(lying);
      await expect(zip.read('a')).rejects.toThrow(ZipError);
      zip.close();
      await expect(listZipEntries(good)).resolves.toEqual(['a']);
    }
    await new Promise((resolve) => setImmediate(resolve));
    expect(openFileDescriptors()).toBe(before);
  });

  it('lists 25000 entries from disk in time linear in the entry count', async () => {
    const write = (count: number) => {
      const path = join(directory, `many-${count}.zip`);
      writeFileSync(
        path,
        buildZip(
          Array.from({ length: count }, (_item, index) => ({
            name: `tests/${index}.in`,
            content: 'x',
          })),
        ),
      );
      return path;
    };
    const small = write(2500);
    const large = write(25000);
    await listZipEntries(small);
    const smallMs = await timeOf(() => listZipEntries(small));
    let names: string[] = [];
    const largeMs = await timeOf(async () => {
      names = await listZipEntries(large);
    });
    expect(names).toHaveLength(25000);
    expect(largeMs).toBeLessThan(15_000);
    expect(largeMs).toBeLessThan(Math.max(smallMs, 20) * 40);
  });
});
