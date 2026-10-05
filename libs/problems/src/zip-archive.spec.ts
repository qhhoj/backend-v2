import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
    ['duplicate names', [{ name: 'a' }, { name: 'a' }]],
    [
      'symlinks',
      [{ name: 'link', symlink: true, content: '../../etc/passwd' }],
    ],
  ])('refuses %s', (_label, entries) => rejects(entries, ZipError));

  it('refuses control characters for their own reason', () =>
    rejects([{ name: 'a\u0001b' }], 'control characters'));

  it('refuses a corrupt archive with a plain message', () =>
    expect(ZipArchive.fromBuffer(Buffer.from('not a zip'))).rejects.toThrow(
      new ZipError('The archive is not a valid zip file.'),
    ));

  it('stops at 25000 entries and 2 GiB declared', async () => {
    const gigabyte = 1024 ** 3;
    const megabyte = Buffer.alloc(1024 * 1024);
    await rejects(
      [
        { name: 'a', content: megabyte, declaredSize: gigabyte },
        { name: 'b', content: megabyte, declaredSize: gigabyte },
        { name: 'c', content: 'x', declaredSize: 1 },
      ],
      'The archive is too large',
    );
    await rejects(
      [{ name: 'tiny', content: 'x', declaredSize: 5000 }],
      'impossible compression ratio',
    );
    const many = Array.from({ length: 25001 }, (_item, index) => ({
      name: `f${index}`,
    }));
    await rejects(many, 'The archive has too many files');
  });

  it('refuses to read a member above the entry cap', async () => {
    const zip = await open([
      {
        name: 'big',
        content: Buffer.alloc(600 * 1024),
        declaredSize: 600 * 1024 ** 2,
      },
    ]);
    await expect(zip.read('big')).rejects.toThrow(
      new ZipError('big is too large to read'),
    );
    zip.close();
  });

  it('catches a member that holds more or fewer bytes than it declares', async () => {
    const zip = await open([
      { name: 'longer', content: Buffer.alloc(4096), declaredSize: 1024 },
      { name: 'shorter', content: Buffer.alloc(1024), declaredSize: 2048 },
    ]);
    const mismatch = (name: string) =>
      new ZipError(`${name} does not match its declared size`);
    await expect(zip.read('longer')).rejects.toThrow(mismatch('longer'));
    await expect(zip.read('shorter')).rejects.toThrow(mismatch('shorter'));
    zip.close();
  });

  it('stops inflating a lying member without buffering the rest', async () => {
    const zip = await open([
      {
        name: 'longer',
        content: Buffer.alloc(8 * 1024 * 1024),
        declaredSize: 1024,
      },
    ]);
    const stream = await zip.stream('longer');
    let received = 0;
    await expect(
      (async () => {
        for await (const chunk of stream) received += (chunk as Buffer).length;
      })(),
    ).rejects.toThrow(ZipError);
    expect(received).toBeLessThanOrEqual(1024);
    zip.close();
  });

  it('aborts a deflate bomb that declares a small size', async () => {
    const bomb = buildZip([
      {
        name: 'bomb',
        content: deflateRawSync(Buffer.alloc(64 * 1024 ** 2)),
        declaredSize: 1024,
      },
    ]);
    const centralStart = bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bomb.writeUInt16LE(8, centralStart + 10);
    const before = openFileDescriptors();
    const zip = await ZipArchive.fromBuffer(bomb);
    let received = 0;
    await expect(
      (async () => {
        for await (const chunk of await zip.stream('bomb'))
          received += (chunk as Buffer).length;
      })(),
    ).rejects.toThrow(new ZipError('bomb does not match its declared size'));
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
      buildZip([{ name: 'a', content: Buffer.alloc(64), declaredSize: 8 }]),
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
    expect(largeMs).toBeLessThan(5000);
    expect(largeMs).toBeLessThan(Math.max(smallMs, 20) * 40);
  });
});
