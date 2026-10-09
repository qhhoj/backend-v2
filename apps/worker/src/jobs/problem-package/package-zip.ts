import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ZipFile } from 'yazl';
import { PACKAGE_MAX_BYTES } from '@libs/problems';

export interface PackageLimits {
  /** Total uncompressed bytes of all entries. */
  maxBytes: number;
}
export const PACKAGE_LIMITS = Symbol('PACKAGE_LIMITS');
export const DEFAULT_PACKAGE_LIMITS: PackageLimits = {
  maxBytes: PACKAGE_MAX_BYTES,
};

/** The package would pass the size cap; raised before any file is written. */
export class PackageTooLargeError extends Error {}

export type PackageEntry =
  | { name: string; text: string }
  | { name: string; path: string; bytes: number };

const bytesOf = (entry: PackageEntry): number =>
  'text' in entry ? Buffer.byteLength(entry.text) : entry.bytes;

/** Zip headers and rounding on top of the entries' own bytes. */
const ZIP_OVERHEAD_BYTES = 1024 * 1024;

/** Fails the stream once more than `maxBytes` went through: the size summed from `stat` can be outrun by a file that grows while it is streamed (preflight M10). */
const capBytes = (maxBytes: number): Transform => {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      seen += chunk.length;
      done(
        seen > maxBytes + ZIP_OVERHEAD_BYTES
          ? new PackageTooLargeError(`package output passes ${maxBytes} bytes`)
          : null,
        chunk,
      );
    },
  });
};

/** Files are streamed from disk (binary-safe, unlike `lazy-zip.ts`, which carries text); the size is summed from the entries first, so an oversize package never starts a file, and the output is capped while streaming, so a file that grew after its `stat` cannot pass the cap either. A failed write leaves no file. */
export async function writePackageZip(
  entries: readonly PackageEntry[],
  target: { path: string; maxBytes: number },
): Promise<void> {
  const total = entries.reduce((sum, entry) => sum + bytesOf(entry), 0);
  if (total > target.maxBytes)
    throw new PackageTooLargeError(
      `package of ${total} bytes passes the ${target.maxBytes} byte cap`,
    );
  const zip = new ZipFile();
  for (const entry of entries)
    if ('text' in entry) zip.addBuffer(Buffer.from(entry.text), entry.name);
    else zip.addFile(entry.path, entry.name);
  zip.end();
  try {
    await pipeline(
      zip.outputStream as Readable,
      capBytes(target.maxBytes),
      createWriteStream(target.path, { flags: 'wx' }),
    );
  } catch (error) {
    await rm(target.path, { force: true });
    throw error;
  }
}
