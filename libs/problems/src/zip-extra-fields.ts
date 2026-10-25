import { crc32 } from 'node:zlib';
import type { Entry } from 'yauzl';

/**
 * judge-v2 reads archives with the Rust `zip` crate (2.4), which parses some extra fields itself: one that does not
 * parse fails the whole archive (the crate then tries an older end record, so it may read an archive stored inside
 * an entry), a Unicode Path field renames the entry, a zip64 field replaces its sizes and offset. yauzl skips or
 * reads them by other rules, so an entry is refused unless both readers take the same name, sizes and offset from it.
 * The rules mirror the crate's `parse_single_extra_field`; the contract fixtures (judge-contract/) check them.
 */
type ExtraField = Entry['extraFields'][number];

const ZIP64 = 0x0001;
const NTFS_TIMES = 0x000a;
const EXTENDED_TIMESTAMP = 0x5455;
const UNICODE_PATH = 0x7075;
/** AES encryption and Unicode Comment: refused outright (the backend reads neither, the crate fails on bad ones). */
const UNREAD_FIELDS = new Set([0x9901, 0x6375]);

const NTFS_LENGTH = 32;
const NTFS_TIMES_TAG = 1;
const NTFS_TIMES_SIZE = 24;
const TIMESTAMP_FLAGS = 0b111;
const ZIP64_FULL_LENGTH = 24;
const UNICODE_PATH_VERSION = 1;
const UNICODE_PATH_HEADER = 5;

const setBits = (flags: number) =>
  [1, 2, 4].filter((bit) => flags & bit).length;

/** The crate's ExtendedTimestamp: no unknown flag, and the length matches the flags (or is the 5-byte central form). */
const timestampIsValid = ({ data }: ExtraField) =>
  data.length > 0 &&
  (data[0] & ~TIMESTAMP_FLAGS) === 0 &&
  (data.length === 5 || data.length === 1 + 4 * setBits(data[0]));

const ntfsIsValid = ({ data }: ExtraField) =>
  data.length === NTFS_LENGTH &&
  data.readUInt16LE(4) === NTFS_TIMES_TAG &&
  data.readUInt16LE(6) === NTFS_TIMES_SIZE;

/** A full (24-byte) zip64 field is read whole by the crate, only for the 0xFFFFFFFF values by yauzl: they must agree. */
const zip64Agrees = (entry: Entry, { data }: ExtraField) =>
  data.length < ZIP64_FULL_LENGTH ||
  [
    entry.uncompressedSize,
    entry.compressedSize,
    entry.relativeOffsetOfLocalHeader,
  ].every((value, index) => data.readBigUInt64LE(index * 8) === BigInt(value));

const isUtf8 = (bytes: Buffer) =>
  Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes);

/** yauzl takes the first version-1 field whose checksum matches, the crate the last field of any version (and fails the archive on a bad checksum or invalid UTF-8): only one valid field names an entry the same on both. */
const unicodePathIsValid = (entry: Entry, { data }: ExtraField) =>
  data.length > UNICODE_PATH_HEADER &&
  data[0] === UNICODE_PATH_VERSION &&
  data.readUInt32LE(1) === crc32(entry.fileNameRaw) &&
  isUtf8(data.subarray(UNICODE_PATH_HEADER));

const count = (fields: ExtraField[], id: number) =>
  fields.filter((field) => field.id === id).length;

function fieldProblem(entry: Entry, field: ExtraField): string | undefined {
  if (UNREAD_FIELDS.has(field.id)) return 'carries an unsupported extra field';
  if (field.id === EXTENDED_TIMESTAMP && !timestampIsValid(field))
    return 'has a malformed timestamp field';
  if (field.id === NTFS_TIMES && !ntfsIsValid(field))
    return 'has a malformed NTFS times field';
  if (field.id === ZIP64 && !zip64Agrees(entry, field))
    return 'has a zip64 field that contradicts its header';
  if (field.id === UNICODE_PATH && !unicodePathIsValid(entry, field))
    return 'has an invalid Unicode path';
  return undefined;
}

/** Why the judge would refuse or misread this entry's extra fields, as a phrase after the entry's name; else undefined. */
export function extraFieldProblem(entry: Entry): string | undefined {
  const fields = entry.extraFields;
  if (count(fields, UNICODE_PATH) > 1 || count(fields, ZIP64) > 1)
    return 'has a repeated extra field';
  for (const field of fields) {
    const problem = fieldProblem(entry, field);
    if (problem) return problem;
  }
  return undefined;
}
