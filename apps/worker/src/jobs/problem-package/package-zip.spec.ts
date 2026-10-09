import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PackageTooLargeError, writePackageZip } from './package-zip';

describe('writePackageZip', () => {
  const directory = mkdtempSync(join(tmpdir(), 'qhhoj-package-zip-'));
  afterAll(() => rmSync(directory, { recursive: true, force: true }));

  it('refuses a file that grew after its size was read, and leaves no partial zip', async () => {
    const source = join(directory, 'grown.bin');
    writeFileSync(source, randomBytes(3 * 1024 * 1024));
    const target = join(directory, 'out.zip');
    await expect(
      writePackageZip([{ name: 'grown.bin', path: source, bytes: 10 }], {
        path: target,
        maxBytes: 1000,
      }),
    ).rejects.toBeInstanceOf(PackageTooLargeError);
    expect(existsSync(target)).toBe(false);
  });

  it('refuses an oversize package before creating any file', async () => {
    const target = join(directory, 'never.zip');
    await expect(
      writePackageZip([{ name: 'a.txt', text: 'x'.repeat(50) }], {
        path: target,
        maxBytes: 10,
      }),
    ).rejects.toBeInstanceOf(PackageTooLargeError);
    expect(existsSync(target)).toBe(false);
  });
});
