import { open as openFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { crc32 } from 'node:zlib';
import { pipeline, Readable as ReadableStream, Transform } from 'node:stream';
import type { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import yauzl from 'yauzl';
import type { Entry, ZipFile } from 'yauzl';
import { hasDotSegment } from './file-names';
import { extraFieldProblem } from './zip-extra-fields';

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
/** Linux NAME_MAX, the judge's limit when it extracts; a path stays well under PATH_MAX below its cache directory. */
const MAX_SEGMENT_BYTES = 255;
const MAX_NAME_BYTES = 1024;

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
/** yauzl shows CP437 control bytes as symbols (☺, ⌂), the judge keeps them raw, so the decoded name cannot tell. */
const hasControlByte = (raw: Buffer) =>
  raw.some((byte) => byte < FIRST_PRINTABLE || byte === DELETE_CHARACTER);
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
const isTooLong = (name: string) =>
  Buffer.byteLength(name) > MAX_NAME_BYTES ||
  name
    .split('/')
    .some((segment) => Buffer.byteLength(segment) > MAX_SEGMENT_BYTES);

/** The first rule an entry's name breaks, or undefined: anything the judge would refuse or name differently. */
function nameViolation(entry: Entry): string | undefined {
  const name = shown(entry.fileName);
  if (hasControlCharacter(entry.fileName) || hasControlByte(entry.fileNameRaw))
    return 'File names must not contain control characters.';
  if (entry.fileName === '' || hasBadSegment(entry.fileName))
    return `Invalid file name: ${name}`;
  if (isTooLong(entry.fileName))
    return `${name} is too long: at most ${MAX_SEGMENT_BYTES} bytes per folder or file name and ${MAX_NAME_BYTES} in all.`;
  const fields = extraFieldProblem(entry);
  return fields && `${name} ${fields}.`;
}

/** The first rule an entry breaks, or undefined. yauzl itself rejects `..`, absolute paths and backslashes. */
function violation(
  entry: Entry,
  records: number,
  bounds: ArchiveBounds,
): string | undefined {
  const name = shown(entry.fileName);
  if (records > ZIP_LIMITS.maxEntries)
    return `The archive has too many files (limit ${ZIP_LIMITS.maxEntries}).`;
  const badName = nameViolation(entry);
  if (badName) return badName;
  if (isSymlink(entry)) return `Symbolic links are not allowed: ${name}`;
  // Folders too: the judge's Rust `zip` crate parses every record and its local header when it opens the archive.
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

/** Files and folders seen so far; the judge cannot extract a file and a folder of the same name, and its Rust `zip` crate keeps one of two records with the same name, so it would count fewer records than the end record names. */
class ArchivePaths {
  private readonly files = new Set<string>();
  private readonly folders = new Set<string>();
  private readonly folderRecords = new Set<string>();

  /** Records the entry; why its path clashes with one seen before, else undefined. */
  clash(entry: Entry): string | undefined {
    const path = entry.fileName.replace(/\/$/, '');
    if (isDirectory(entry) && this.folderRecords.has(path))
      return `Duplicate folder in the archive: ${shown(entry.fileName)}`;
    if (isDirectory(entry)) this.folderRecords.add(path);
    return this.add(entry, path)
      ? undefined
      : `A file and a folder share a name: ${shown(entry.fileName)}`;
  }

  private add(entry: Entry, path: string): boolean {
    const parents = path.split('/').slice(0, -1);
    const prefixes = parents.map((_segment, index) =>
      parents.slice(0, index + 1).join('/'),
    );
    if (prefixes.some((prefix) => this.files.has(prefix))) return false;
    prefixes.forEach((prefix) => this.folders.add(prefix));
    const [own, other] = isDirectory(entry)
      ? [this.folders, this.files]
      : [this.files, this.folders];
    if (other.has(path)) return false;
    own.add(path);
    return true;
  }
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
const ZIP64_RECORD_BYTES = 56;
const ZIP64_COUNT_AT = 32;
const ZIP64_CENTRAL_OFFSET_AT = 48;

/** Reads `length` bytes at `position` of the archive. */
type ReadAt = (position: number, length: number) => Promise<Buffer>;

interface EndRecords {
  endRecordStart: number;
  /** The zip64 end record's offset, when a zip64 locator precedes the end record. */
  zip64RecordStart?: number;
}

async function endRecordsOf(zip: ZipFile, readAt: ReadAt): Promise<EndRecords> {
  const { fileSize, comment } = zip as unknown as ZipFileInternals;
  const endRecordStart = fileSize - END_RECORD_BYTES - comment.length;
  const locatorStart = endRecordStart - ZIP64_LOCATOR_BYTES;
  if (locatorStart < 0) return { endRecordStart };
  const locator = await readAt(locatorStart, ZIP64_LOCATOR_BYTES);
  return locator.readUInt32LE(0) === ZIP64_LOCATOR_SIGNATURE
    ? {
        endRecordStart,
        zip64RecordStart: Number(
          locator.readBigUInt64LE(ZIP64_RECORD_OFFSET_AT),
        ),
      }
    : { endRecordStart };
}

/** yauzl counts the end record's total entries, the judge's Rust `zip` crate those on this disk: they must agree. yauzl reads the zip64 end record whenever its locator is there, the crate only when the end record's count or offset is 0xFFFF(FFFF): an end record that is not must agree with the zip64 one. */
async function endRecordsAgree(
  { endRecordStart, zip64RecordStart }: EndRecords,
  readAt: ReadAt,
): Promise<boolean> {
  const end = await readAt(endRecordStart, END_RECORD_BYTES);
  const [count, offset] = [end.readUInt16LE(10), end.readUInt32LE(16)];
  if (end.readUInt16LE(8) !== count) return false;
  if (zip64RecordStart === undefined) return true;
  if (count === 0xffff || offset === 0xffffffff) return true;
  const zip64 = await readAt(zip64RecordStart, ZIP64_RECORD_BYTES);
  return (
    zip64.readBigUInt64LE(ZIP64_COUNT_AT) === BigInt(count) &&
    zip64.readBigUInt64LE(ZIP64_CENTRAL_OFFSET_AT) === BigInt(offset)
  );
}

/** The judge's Rust `zip` crate trusts the central directory offset, yauzl the entry count; a count that hides records would skip every check, so the records must end exactly where the end record (zip64 or not) starts, and both end records must say the same. */
async function assertCentralDirectoryIsConsistent(
  zip: ZipFile,
  readAt: ReadAt,
): Promise<void> {
  const { readEntryCursor } = zip as unknown as ZipFileInternals;
  const records = await endRecordsOf(zip, readAt);
  const centralEnd = records.zip64RecordStart ?? records.endRecordStart;
  if (
    readEntryCursor !== centralEnd ||
    !(await endRecordsAgree(records, readAt))
  )
    throw new ZipError(
      'Archive central directory is inconsistent.',
      'zip_inconsistent',
    );
}

/** The records, folders included, whose local headers must fit before the central directory. */
interface Collected {
  entries: Map<string, Entry>;
  spans: Entry[];
  centralDirectoryStart: number;
}

/** Walks the central directory once (lazy entries) and applies every bound. Every record counts, directories included. */
function collectEntries(zip: ZipFile): Promise<Collected> {
  return new Promise((resolve, reject) => {
    const entries = new Map<string, Entry>();
    const spans: Entry[] = [];
    const paths = new ArchivePaths();
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
    zip.on('end', () =>
      resolve({
        entries,
        spans,
        centralDirectoryStart: bounds.centralDirectoryStart,
      }),
    );
    zip.on('entry', (entry: Entry) => {
      records += 1;
      const broken = violation(entry, records, bounds);
      if (broken) return fail(broken, 'zip_entry_rejected');
      const clash = paths.clash(entry);
      if (clash) return fail(clash, 'zip_duplicate_entry');
      spans.push(entry);
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

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const LOCAL_NAME_LENGTH_AT = 26;
const LOCAL_EXTRA_LENGTH_AT = 28;

/** The crate reads every record's local header at open and refuses data that starts after the central directory; yauzl reads a local header only when an entry is read. Each record's local header and data must end before the central directory. */
async function assertLocalHeadersFit(
  { spans, centralDirectoryStart }: Collected,
  readAt: ReadAt,
): Promise<void> {
  for (const entry of spans) {
    const header = await readAt(
      entry.relativeOffsetOfLocalHeader,
      LOCAL_HEADER_BYTES,
    );
    const dataEnd =
      entry.relativeOffsetOfLocalHeader +
      LOCAL_HEADER_BYTES +
      header.readUInt16LE(LOCAL_NAME_LENGTH_AT) +
      header.readUInt16LE(LOCAL_EXTRA_LENGTH_AT) +
      entry.compressedSize;
    if (
      header.readUInt32LE(0) !== LOCAL_HEADER_SIGNATURE ||
      dataEnd > centralDirectoryStart
    )
      throw new ZipError(
        `${shown(entry.fileName)} points outside the archive.`,
        'zip_entry_rejected',
      );
  }
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
      const collected = await collectEntries(zip);
      await assertCentralDirectoryIsConsistent(zip, readAt);
      await assertLocalHeadersFit(collected, readAt);
      return new ZipArchive(zip, collected.entries, closed);
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
    return this.checkedStream(entry);
  }

  /** The entry's bytes through `exactly`, with no size bound. */
  private async checkedStream(entry: Entry): Promise<Readable> {
    const name = entry.fileName;
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

  /** Reads every file entry through to its end, so a size or CRC-32 that does not match fails here (with the stream's `ZipError`), as it would when the judge extracts the archive. */
  async verifyAll(): Promise<void> {
    for (const entry of this.entries.values()) {
      const stream = await this.checkedStream(entry);
      await finished(stream.resume());
    }
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

/** What an upload accepts: every entry listed and read (sizes and CRC-32 checked, as the judge's extraction does), and the files a case may name. */
export async function checkUploadedZip(path: string): Promise<string[]> {
  const zip = await ZipArchive.open(path);
  try {
    await zip.verifyAll();
    return zip.names().filter((name) => !hasDotSegment(name));
  } finally {
    await zip.close();
  }
}
