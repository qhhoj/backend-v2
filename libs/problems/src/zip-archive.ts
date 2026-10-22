import { open as openFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { crc32 } from 'node:zlib';
import { pipeline, Readable as ReadableStream, Transform } from 'node:stream';
import type { Readable } from 'node:stream';
import yauzl from 'yauzl';
import type { Entry, ZipFile } from 'yauzl';
import { hasDotSegment } from './file-names';

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
const LOCAL_HEADER_BYTES = 30;
const READ_CHUNK_BYTES = 64 * 1024;

interface ArchiveBounds {
  fileSize: number;
  centralDirectoryStart: number;
}
const UNICODE_PATH_EXTRA = 0x7075;

/** A problem in an uploaded archive; the message is shown to the uploader, the snake_case `code` is the stable key (documented in docs/decisions.md). */
export class ZipError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
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
  !entry.fileNameRaw.equals(Buffer.from(entry.fileName, 'utf8'));

/** The first rule an entry breaks, or undefined. yauzl itself rejects `..`, absolute paths and backslashes. */
function violation(
  entry: Entry,
  records: number,
  bounds: ArchiveBounds,
): string | undefined {
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
    entry.relativeOffsetOfLocalHeader + LOCAL_HEADER_BYTES > bounds.fileSize ||
    entry.relativeOffsetOfLocalHeader +
      LOCAL_HEADER_BYTES +
      entry.compressedSize >
      bounds.centralDirectoryStart
  )
    return `${name} points outside the archive.`;
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

const ZIP64_LOCATOR_BYTES = 20;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_RECORD_OFFSET_AT = 8;

/** Reads `length` bytes at `position` of the archive. */
type ReadAt = (position: number, length: number) => Promise<Buffer>;

/** Where the central directory must end: at the zip64 end record when a zip64 locator precedes the end record, else at the end record itself. */
async function expectedCentralEnd(
  zip: ZipFile,
  readAt: ReadAt,
): Promise<number> {
  const { fileSize, comment } = zip as unknown as ZipFileInternals;
  const endRecordStart = fileSize - END_RECORD_BYTES - comment.length;
  const locatorStart = endRecordStart - ZIP64_LOCATOR_BYTES;
  if (locatorStart < 0) return endRecordStart;
  const locator = await readAt(locatorStart, ZIP64_LOCATOR_BYTES);
  return locator.readUInt32LE(0) === ZIP64_LOCATOR_SIGNATURE
    ? Number(locator.readBigUInt64LE(ZIP64_RECORD_OFFSET_AT))
    : endRecordStart;
}

/** Python's zipfile (the judge) trusts the central directory offset, yauzl the entry count; a count that hides records would skip every check, so the records must end exactly where the end record (zip64 or not) starts. */
async function assertCentralDirectoryIsConsistent(
  zip: ZipFile,
  readAt: ReadAt,
): Promise<void> {
  const { readEntryCursor } = zip as unknown as ZipFileInternals;
  if (readEntryCursor !== (await expectedCentralEnd(zip, readAt)))
    throw new ZipError(
      'Archive central directory is inconsistent.',
      'zip_inconsistent',
    );
}

/** Walks the central directory once (lazy entries, so memory is one entry at a time) and applies every bound. Every record counts, directories included. */
function collectEntries(zip: ZipFile): Promise<Map<string, Entry>> {
  return new Promise((resolve, reject) => {
    const entries = new Map<string, Entry>();
    const { fileSize, readEntryCursor } = zip as unknown as ZipFileInternals;
    const bounds = { fileSize, centralDirectoryStart: readEntryCursor };
    let records = 0;
    let totalBytes = 0;
    const fail = (message: string, code: string) => {
      zip.removeAllListeners('entry');
      reject(new ZipError(message, code));
    };
    zip.on('error', (error: Error) =>
      fail(
        `The archive is not a valid zip file: ${shown(error.message)}`,
        'zip_invalid',
      ),
    );
    zip.on('end', () => resolve(entries));
    zip.on('entry', (entry: Entry) => {
      records += 1;
      const broken = violation(entry, records, bounds);
      if (broken) return fail(broken, 'zip_entry_rejected');
      if (isDirectory(entry)) return zip.readEntry();
      if (entries.has(entry.fileName))
        return fail(
          `Duplicate file in the archive: ${shown(entry.fileName)}`,
          'zip_duplicate_entry',
        );
      totalBytes += entry.uncompressedSize;
      if (totalBytes > ZIP_LIMITS.maxTotalBytes)
        return fail(
          `The archive is too large (limit ${ZIP_LIMITS.maxTotalBytes} bytes uncompressed).`,
          'zip_too_large',
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
        ? reject(
            new ZipError('The archive is not a valid zip file.', 'zip_invalid'),
          )
        : resolve(zip),
    ),
  );

/** Counts the bytes that actually come out and aborts past the declared size, verifies the CRC-32, and turns any failure of the source (zlib, yauzl) into a `ZipError`. */
function exactly(entry: Entry): Transform {
  const name = shown(entry.fileName);
  let seen = 0;
  let checksum = 0;
  const mismatch = () =>
    new ZipError(
      `${name} does not match its declared size`,
      'zip_entry_corrupt',
    );
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
          : new ZipError(
              `${name} is corrupt: its checksum does not match`,
              'zip_entry_corrupt',
            ),
      );
    },
    destroy(error, callback) {
      callback(
        error && !(error instanceof ZipError)
          ? new ZipError(
              `${name} is corrupt: ${error.message}`,
              'zip_entry_corrupt',
            )
          : error,
      );
    },
  });
}

/** Every byte offset in an archive comes from the (untrusted) archive, so a single reader validates them all: yauzl's own fd reader throws a RangeError from inside a callback for offsets past 2^53, which leaves the open hanging and the descriptor leaked. */
class FileHandleReader extends yauzl.RandomAccessReader {
  private closing?: Promise<void>;
  private markClosed!: () => void;
  /** Settles once the handle is closed, whichever path closed it. */
  readonly closed = new Promise<void>((resolve) => {
    this.markClosed = resolve;
  });

  constructor(private readonly handle: FileHandle) {
    super();
  }

  async readAt(position: number, length: number): Promise<Buffer> {
    const { buffer } = await this.handle.read(
      Buffer.alloc(length),
      0,
      length,
      position,
    );
    return buffer;
  }

  _readStreamForRange(start: number, end: number): Readable {
    const valid =
      Number.isSafeInteger(start) &&
      Number.isSafeInteger(end) &&
      start >= 0 &&
      start <= end;
    if (!valid)
      return new ReadableStream({
        read() {
          this.destroy(
            new ZipError(
              'The archive points outside itself.',
              'zip_points_outside',
            ),
          );
        },
      });
    let position = start;
    const handle = this.handle;
    return new ReadableStream({
      read() {
        const length = Math.min(READ_CHUNK_BYTES, end - position);
        if (length <= 0) return void this.push(null);
        handle.read(Buffer.alloc(length), 0, length, position).then(
          ({ bytesRead, buffer }) => {
            position += bytesRead;
            this.push(bytesRead === 0 ? null : buffer.subarray(0, bytesRead));
          },
          (error: Error) => this.destroy(error),
        );
      },
    });
  }

  close(callback: (error: Error | null) => void): void {
    this.closeOnce().then(
      () => callback(null),
      (error: Error) => callback(error),
    );
  }

  /** Closes the handle exactly once, however many paths ask. */
  closeOnce(): Promise<void> {
    this.closing ??= this.handle.close().finally(this.markClosed);
    return this.closing;
  }
}

/** Read-only view of a zip with every bound of `ZIP_LIMITS` enforced; file entries only. */
export class ZipArchive {
  /** `closed` settles once the file under `zip` is closed; yauzl closes it when the archive and every stream from it have let go. */
  private constructor(
    private readonly zip: ZipFile,
    private readonly entries: Map<string, Entry>,
    private readonly closed: Promise<void>,
  ) {}

  static async open(path: string): Promise<ZipArchive> {
    const handle = await openFile(path, 'r').catch(() => {
      throw new ZipError('The archive is not a valid zip file.', 'zip_invalid');
    });
    const reader = new FileHandleReader(handle);
    try {
      const { size } = await handle.stat();
      const zip = await openZipFile((callback) =>
        yauzl.fromRandomAccessReader(reader, size, OPEN_OPTIONS, callback),
      );
      return await ZipArchive.collect(
        zip,
        (position, length) => reader.readAt(position, length),
        reader.closed,
      );
    } catch (error) {
      await reader.closeOnce();
      throw error;
    }
  }

  static async fromBuffer(buffer: Buffer): Promise<ZipArchive> {
    const readAt: ReadAt = (position, length) =>
      Promise.resolve(buffer.subarray(position, position + length));
    return ZipArchive.collect(
      await openZipFile((callback) =>
        yauzl.fromBuffer(buffer, OPEN_OPTIONS, callback),
      ),
      readAt,
      Promise.resolve(),
    );
  }

  private static async collect(
    zip: ZipFile,
    readAt: ReadAt,
    closed: Promise<void>,
  ): Promise<ZipArchive> {
    try {
      const entries = await collectEntries(zip);
      await assertCentralDirectoryIsConsistent(zip, readAt);
      return new ZipArchive(zip, entries, closed);
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
      throw new ZipError(
        `${shown(name)} is too large to read`,
        'zip_entry_too_large',
      );
    const source = await new Promise<Readable>((resolve, reject) =>
      this.zip.openReadStream(entry, (error, stream) =>
        error || !stream
          ? reject(
              new ZipError(
                `Cannot read ${shown(name)}: ${error?.message ?? 'unknown error'}`,
                'zip_entry_unreadable',
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

  /** Resolves once the file is closed, so a caller that awaits it holds no descriptor afterwards. Open streams keep it open until they end or are destroyed. */
  close(): Promise<void> {
    this.zip.close();
    return this.closed;
  }

  private entry(name: string): Entry {
    const entry = this.entries.get(name);
    if (!entry)
      throw new ZipError(
        `No such file in the archive: ${shown(name)}`,
        'zip_entry_missing',
      );
    return entry;
  }
}

/** The files a case may name: an entry with a dot-leading part is accepted in the archive but left out, since the judge cannot open it. */
export async function listZipEntries(path: string): Promise<string[]> {
  const zip = await ZipArchive.open(path);
  try {
    return zip.names().filter((name) => !hasDotSegment(name));
  } finally {
    await zip.close();
  }
}
