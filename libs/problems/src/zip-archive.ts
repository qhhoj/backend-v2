import { pipeline, Transform } from 'node:stream';
import type { Readable } from 'node:stream';
import yauzl from 'yauzl';
import type { Entry, ZipFile } from 'yauzl';

export const ZIP_LIMITS = {
  maxEntries: 25_000,
  maxTotalBytes: 2 * 1024 ** 3,
  maxEntryBytes: 512 * 1024 ** 2,
  /** Deflate tops out near 1032:1; a header claiming more is lying. */
  maxRatio: 1100,
} as const;
/** `validateEntrySizes` is off because `exactly` checks the bytes of both stored and deflated members while streaming. */
const OPEN_OPTIONS = {
  lazyEntries: true,
  autoClose: false,
  validateEntrySizes: false,
  decodeStrings: true,
  strictFileNames: true,
} as const;
const UNIX_TYPE_MASK = 0o170000;
const UNIX_SYMLINK = 0o120000;
const DELETE_CHARACTER = 0x7f;
const FIRST_PRINTABLE = 0x20;

/** A problem in an uploaded archive; the message is shown to the uploader. */
export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

const hasControlCharacter = (name: string) =>
  [...name].some((character) => {
    const code = character.charCodeAt(0);
    return code < FIRST_PRINTABLE || code === DELETE_CHARACTER;
  });
const isDirectory = (entry: Entry) => entry.fileName.endsWith('/');
const isSymlink = (entry: Entry) =>
  ((entry.externalFileAttributes >>> 16) & UNIX_TYPE_MASK) === UNIX_SYMLINK;

/** Walks the central directory once (lazy entries, so memory is one entry at a time) and applies every bound; yauzl itself rejects `..`, absolute paths and backslashes. */
function collectEntries(zip: ZipFile): Promise<Map<string, Entry>> {
  return new Promise((resolve, reject) => {
    const entries = new Map<string, Entry>();
    let totalBytes = 0;
    const fail = (message: string) => {
      zip.removeAllListeners('entry');
      reject(new ZipError(message));
    };
    zip.on('error', (error: Error) =>
      fail(`The archive is not a valid zip file: ${error.message}`),
    );
    zip.on('end', () => resolve(entries));
    zip.on('entry', (entry: Entry) => {
      if (isDirectory(entry)) return zip.readEntry();
      if (hasControlCharacter(entry.fileName))
        return fail('File names must not contain control characters.');
      if (isSymlink(entry))
        return fail(`Symbolic links are not allowed: ${entry.fileName}`);
      if (entries.has(entry.fileName))
        return fail(`Duplicate file in the archive: ${entry.fileName}`);
      if (entries.size >= ZIP_LIMITS.maxEntries)
        return fail(
          `The archive has too many files (limit ${ZIP_LIMITS.maxEntries}).`,
        );
      if (
        entry.uncompressedSize >
        entry.compressedSize * ZIP_LIMITS.maxRatio + 1024
      )
        return fail(
          `${entry.fileName} declares an impossible compression ratio.`,
        );
      totalBytes += entry.uncompressedSize;
      if (totalBytes > ZIP_LIMITS.maxTotalBytes)
        return fail(
          `The archive is too large (limit ${ZIP_LIMITS.maxTotalBytes} bytes uncompressed).`,
        );
      entries.set(entry.fileName, entry);
      zip.readEntry();
    });
    zip.readEntry();
  });
}

const openZipFile = (
  opener: (callback: (error: Error | null, zip?: ZipFile) => void) => void,
) =>
  new Promise<ZipFile>((resolve, reject) =>
    opener((error, zip) =>
      error || !zip
        ? reject(new ZipError('The archive is not a valid zip file.'))
        : resolve(zip),
    ),
  );

/** Counts the bytes that actually come out and aborts past the declared size; stored entries are not size-checked by yauzl, so this covers both methods. */
function exactly(name: string, declaredSize: number): Transform {
  let seen = 0;
  const mismatch = () =>
    new ZipError(`${name} does not match its declared size`);
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      seen += chunk.length;
      callback(seen > declaredSize ? mismatch() : null, chunk);
    },
    flush(callback) {
      callback(seen === declaredSize ? null : mismatch());
    },
  });
}

/** Read-only view of a zip with every bound of `ZIP_LIMITS` enforced; file entries only. */
export class ZipArchive {
  private constructor(
    private readonly zip: ZipFile,
    private readonly entries: Map<string, Entry>,
  ) {}

  static async open(path: string): Promise<ZipArchive> {
    return ZipArchive.collect(
      await openZipFile((callback) => yauzl.open(path, OPEN_OPTIONS, callback)),
    );
  }

  static async fromBuffer(buffer: Buffer): Promise<ZipArchive> {
    return ZipArchive.collect(
      await openZipFile((callback) =>
        yauzl.fromBuffer(buffer, OPEN_OPTIONS, callback),
      ),
    );
  }

  private static async collect(zip: ZipFile): Promise<ZipArchive> {
    try {
      return new ZipArchive(zip, await collectEntries(zip));
    } catch (error) {
      zip.close();
      throw error;
    }
  }

  names(): string[] {
    return [...this.entries.keys()];
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  sizeOf(name: string): number {
    return this.entry(name).uncompressedSize;
  }

  /** The stream errors with a `ZipError` as soon as more bytes than declared are inflated, or when fewer arrive. */
  async stream(name: string): Promise<Readable> {
    const entry = this.entry(name);
    if (entry.uncompressedSize > ZIP_LIMITS.maxEntryBytes)
      throw new ZipError(`${name} is too large to read`);
    const source = await new Promise<Readable>((resolve, reject) =>
      this.zip.openReadStream(entry, (error, stream) =>
        error || !stream
          ? reject(
              new ZipError(
                `Cannot read ${name}: ${error?.message ?? 'unknown error'}`,
              ),
            )
          : resolve(stream),
      ),
    );
    return pipeline(source, exactly(name, entry.uncompressedSize), () => {});
  }

  async read(name: string): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of await this.stream(name))
      chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }

  close(): void {
    this.zip.close();
  }

  private entry(name: string): Entry {
    const entry = this.entries.get(name);
    if (!entry) throw new ZipError(`No such file in the archive: ${name}`);
    return entry;
  }
}

export async function listZipEntries(path: string): Promise<string[]> {
  const zip = await ZipArchive.open(path);
  try {
    return zip.names();
  } finally {
    zip.close();
  }
}
