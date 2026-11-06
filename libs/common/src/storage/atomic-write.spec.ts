import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Readable } from 'node:stream';
import { atomicWrite, isTempName } from './atomic-write';

describe('atomicWrite', () => {
  const root = mkdtempSync(join(tmpdir(), 'qhhoj-atomic-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('writes a file whose name is near the limit, the temp file being short', async () => {
    const target = join(root, 'long', `${'n'.repeat(250)}.zip`);
    await atomicWrite(target, Buffer.from('zip'));
    expect(readFileSync(target, 'utf8')).toBe('zip');
    expect(readdirSync(join(root, 'long'))).toEqual([`${'n'.repeat(250)}.zip`]);
  });
  it('leaves no temp file when the stream fails mid-write', async () => {
    const failing = new Readable({
      read() {
        this.push(Buffer.from('partial'));
        this.destroy(new Error('stream broke'));
      },
    });
    await expect(
      atomicWrite(join(root, 'broken', 'a.zip'), failing),
    ).rejects.toThrow('stream broke');
    expect(readdirSync(join(root, 'broken'))).toEqual([]);
  });
  it('hands a function the temp path and renames what it wrote', async () => {
    const target = join(root, 'fn', 'a.pdf');
    let seen = '';
    await atomicWrite(target, async (temporary) => {
      seen = temporary;
      writeFileSync(temporary, 'pdf');
    });
    expect(isTempName(basename(seen))).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe('pdf');
    expect(readdirSync(join(root, 'fn'))).toEqual(['a.pdf']);
  });
  it('names only its own temp files', () => {
    expect(isTempName('.0199a000-0000-7000-8000-000000000001.tmp')).toBe(true);
    expect(isTempName('notes.tmp')).toBe(false);
    expect(isTempName('0199a000-0000-7000-8000-000000000001.zip')).toBe(false);
  });
});
