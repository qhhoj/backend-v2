import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { writeFileAtomically } from './atomic-write';

describe('writeFileAtomically', () => {
  const root = mkdtempSync(join(tmpdir(), 'qhhoj-atomic-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('writes a file whose name is near the limit, the temp file being short', async () => {
    const target = join(root, 'long', `${'n'.repeat(250)}.zip`);
    await writeFileAtomically(target, Buffer.from('zip'));
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
      writeFileAtomically(join(root, 'broken', 'a.zip'), failing),
    ).rejects.toThrow('stream broke');
    expect(readdirSync(join(root, 'broken'))).toEqual([]);
  });
});
