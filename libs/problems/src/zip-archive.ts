import { crc32 } from 'node:zlib';
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
const OPEN_OPTIONS = {
  lazyEntries: true,
  autoClose: false,
  validateEntrySizes: true,
  decodeStrings: true,
  strictFileNames: true,
} as const;
const UNIX_TYPE_MASK = 0o170000;
const UNIX_SYMLINK = 0o120000;
const DELETE_CHARACTER = 0x7f;
const FIRST_PRINTABLE = 0x20;
const MAX_SHOWN_NAME = 100;
const END_RECORD_BYTES = 22;
const UNICODE_PATH_EXTRA = 0x7075;

/** A problem in an uploaded archive; the message is shown to the uploader. */
export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

const isControlCharacter = (character: string) => {
  const code = character.charCodeAt(0);
  return code < FIRST_PRINTABLE || code === DELETE_CHARACTER;
};
const hasControlCharacter = (name: string) =>
  [...name].some(isControlCharacter);
/** A name that is safe to echo in a message. */
const shown = (name: string) =>
  [...name]
    .filter((character) => !isControlCharacter(character))
    .join('')
    .slice(0, MAX_SHOWN_NAME);
const isDirectory = (entry: Entry) => entry.fileName.endsWith('/');
const isSymlink = (entry: Entry) =>
  ((entry.externalFileAttributes >>> 16) & UNIX_TYPE_MASK) === UNIX_SYMLINK;
const hasBadSegment = (name: string) =>
  (name.endsWith('/') ? name.slice(0, -1) : name)
    .split('/')
    .some((segment) => segment === '' || segment === '.');
/** yauzl names an entry from its Unicode Path extra, Python's zipfile from the raw name; refuse the entries on which they differ. */
const hasForeignUnicodePath = (entry: Entry) =>
  entry.extraFields.some((field) => field.id === UNICODE_PATH_EXTRA) &&
  !(entry as Entry & { fileNameRaw: Buffer }).fileNameRaw.equals(
    Buffer.from(entry.fileName, 'utf8'),
  );

/** The first rule an entry breaks, or undefined. yauzl itself rejects `..`, absolute paths and backslashes. */
function violation(entry: Entry, records: number): string | undefined {
  const name = shown(entry.fileName);
  if (records > ZIP_LIMITS.maxEntries)
    return `The archive has too many files (limit ${ZIP_LIMITS.maxEntries}).`;
  if (hasControlCharacter(entry.fileName))
    return 'File names must not contain control characters.';
  if (entry.fileName === '' || hasBadSegment(entry.fileName))
    return `Invalid file name: ${name}`;
  if (hasForeignUnicodePath(entry))
    return `${name} has a Unicode path that differs from its name.`;
  if (isDirectory(entry)) return undefined;
  if (isSymlink(entry)) return `Symbolic links are not allowed: ${name}`;
  if (!entry.canDecodeFileData())
    return `${name} is encrypted or uses an unsupported compression method.`;
  if (
    entry.uncompressedSize >
    entry.compressedSize * ZIP_LIMITS.maxRatio + 1024
  )
    return `${name} declares an impossible compression ratio.`;
  return undefined;
}

/** yauzl's internals that the typings leave out or get wrong. */
interface ZipFileInternals {
  /** A byte offset, although @types/yauzl says boolean. */
  readEntryCursor: number;
  fileSize: number;
  comment: string;
}

/** Python's zipfile (the judge) trusts the central directory offset, yauzl the entry count; a count that hides records would skip every check, so the records must end exactly where the end record starts. Zip64 archives, whose end record is preceded by a zip64 one, are refused as inconsistent too. */
function endsWhereEndRecordStarts(zip: ZipFile): boolean {
  const { readEntryCursor, fileSize, comment } =
    zip as unknown as ZipFileInternals;
  return readEntryCursor === fileSize - END_RECORD_BYTES - comment.length;
}

/** Walks the central directory once (lazy entries, so memory is one entry at a time) and applies every bound. Every record counts, directories included. */
function collectEntries(zip: ZipFile): Promise<Map<string, Entry>> {
  return new Promise((resolve, reject) => {
    const entries = new Map<string, Entry>();
    let records = 0;
    let totalBytes = 0;
    const fail = (message: string) => {
      zip.removeAllListeners('entry');
      reject(new ZipError(message));
    };
    zip.on('error', (error: Error) =>
      fail(`The archive is not a valid zip file: ${shown(error.message)}`),
    );
    zip.on('end', () =>
      endsWhereEndRecordStarts(zip)
        ? resolve(entries)
        : fail('Archive central directory is inconsistent.'),
    );
    zip.on('entry', (entry: Entry) => {
      records += 1;
      const broken = violation(entry, records);
      if (broken) return fail(broken);
      if (isDirectory(entry)) return zip.readEntry();
      if (entries.has(entry.fileName))
        return fail(`Duplicate file in the archive: ${shown(entry.fileName)}`);
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

/** Counts the bytes that actually come out and aborts past the declared size, verifies the CRC-32, and turns any failure of the source (zlib, yauzl) into a `ZipError`. */
function exactly(entry: Entry): Transform {
  const name = shown(entry.fileName);
  let seen = 0;
  let checksum = 0;
  const mismatch = () =>
    new ZipError(`${name} does not match its declared size`);
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      seen += chunk.length;
      checksum = crc32(chunk, checksum);
      callback(seen > entry.uncompressedSize ? mismatch() : null, chunk);
    },
    flush(callback) {
      if (seen !== entry.uncompressedSize) return callback(mismatch());
      callback(
        checksum === entry.crc32
          ? null
          : new ZipError(`${name} is corrupt: its checksum does not match`),
      );
    },
    destroy(error, callback) {
      callback(
        error && !(error instanceof ZipError)
          ? new ZipError(`${name} is corrupt: ${error.message}`)
          : error,
      );
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

  /** The stream errors with a `ZipError` as soon as more bytes than declared are inflated, or when fewer arrive or the data is corrupt. The caller must consume or destroy it: an abandoned stream keeps the file open. */
  async stream(name: string): Promise<Readable> {
    const entry = this.entry(name);
    if (entry.uncompressedSize > ZIP_LIMITS.maxEntryBytes)
      throw new ZipError(`${shown(name)} is too large to read`);
    const source = await new Promise<Readable>((resolve, reject) =>
      this.zip.openReadStream(entry, (error, stream) =>
        error || !stream
          ? reject(
              new ZipError(
                `Cannot read ${shown(name)}: ${error?.message ?? 'unknown error'}`,
              ),
            )
          : resolve(stream),
      ),
    );
    return pipeline(source, exactly(entry), () => {});
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
    if (!entry)
      throw new ZipError(`No such file in the archive: ${shown(name)}`);
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
