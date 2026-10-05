import { crc32, deflateRawSync } from 'node:zlib';

export const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48,
  0x44, 0x52,
]);
export const JPG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46,
]);
export const GIF = Buffer.from('GIF89a\u0001\u0000\u0001\u0000', 'latin1');
export const SVG = Buffer.from(
  '\ufeff<?xml version="1.0"?>\n<!-- c -->\n<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>',
);
export const SVG_WITH_SCRIPT = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><rect width="1" height="1"/></svg>',
);
export const PDF = Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj', 'latin1');

export interface ZipTestEntry {
  name: string;
  content?: Buffer | string;
  /** Marks the entry as a unix symlink in the external attributes. */
  symlink?: boolean;
  /** Lies about the uncompressed size (bomb and ratio tests). */
  declaredSize?: number;
  /** `store` (default) or raw `deflate` of the content. */
  method?: 'store' | 'deflate';
  /** Bytes written as the entry data instead of the content (corrupt and truncated members). */
  data?: Buffer;
  /** Lies about the CRC-32 of the content. */
  checksum?: number;
  /** Sets the encryption bit. */
  encrypted?: boolean;
  /** Writes this compression method number in both headers (unsupported methods). */
  methodNumber?: number;
  /** Extra field bytes for the central directory header. */
  centralExtra?: Buffer;
}

export interface ZipTestOptions {
  /** Lies about the entry count in the end-of-central-directory record. */
  declaredEntryCount?: number;
  /** Writes a zip64 end record and locator, as Info-ZIP does when streaming from stdin. */
  zip64?: boolean;
}

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_RECORD = 0x06054b50;
const MADE_BY_UNIX = 0x031e;
const UTF8_NAMES_FLAG = 0x0800;
const ENCRYPTED_FLAG = 0x0001;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
const REGULAR_FILE = 0o100644;
const SYMLINK = 0o120777;

/** Hand-written zip: tests need names, attributes and sizes real zip writers refuse (`..`, absolute paths, symlinks, lying sizes). Fewer than 65535 entries. */
export function buildZip(
  entries: ZipTestEntry[],
  options: ZipTestOptions = {},
): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const content = Buffer.isBuffer(entry.content)
      ? entry.content
      : Buffer.from(entry.content ?? '', 'utf8');
    const deflated = entry.method === 'deflate';
    const data = entry.data ?? (deflated ? deflateRawSync(content) : content);
    const method =
      entry.methodNumber ?? (deflated ? METHOD_DEFLATE : METHOD_STORE);
    const flags = UTF8_NAMES_FLAG | (entry.encrypted ? ENCRYPTED_FLAG : 0);
    const declared = entry.declaredSize ?? content.length;
    const checksum = entry.checksum ?? crc32(content);
    const extra = entry.centralExtra ?? Buffer.alloc(0);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(LOCAL_HEADER, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(declared, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    const central = Buffer.alloc(46 + name.length + extra.length);
    central.writeUInt32LE(CENTRAL_HEADER, 0);
    central.writeUInt16LE(MADE_BY_UNIX, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(declared, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(extra.length, 30);
    central.writeUInt32LE(
      ((entry.symlink ? SYMLINK : REGULAR_FILE) << 16) >>> 0,
      38,
    );
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    extra.copy(central, 46 + name.length);
    locals.push(local, data);
    centrals.push(central);
    offset += local.length + data.length;
  }
  const centralSize = centrals.reduce((sum, buffer) => sum + buffer.length, 0);
  const count = options.declaredEntryCount ?? entries.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_RECORD, 0);
  end.writeUInt16LE(options.zip64 ? 0xffff : count, 8);
  end.writeUInt16LE(options.zip64 ? 0xffff : count, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(options.zip64 ? 0xffffffff : offset, 16);
  const zip64 = options.zip64
    ? zip64Tail(count, centralSize, offset, offset + centralSize)
    : Buffer.alloc(0);
  return Buffer.concat([...locals, ...centrals, zip64, end]);
}

const ZIP64_RECORD = 0x06064b50;
const ZIP64_LOCATOR = 0x07064b50;

/** The zip64 end-of-central-directory record followed by its locator. */
function zip64Tail(
  count: number,
  centralSize: number,
  centralOffset: number,
  recordOffset: number,
): Buffer {
  const record = Buffer.alloc(56);
  record.writeUInt32LE(ZIP64_RECORD, 0);
  record.writeBigUInt64LE(44n, 4);
  record.writeUInt16LE(45, 12);
  record.writeUInt16LE(45, 14);
  record.writeBigUInt64LE(BigInt(count), 24);
  record.writeBigUInt64LE(BigInt(count), 32);
  record.writeBigUInt64LE(BigInt(centralSize), 40);
  record.writeBigUInt64LE(BigInt(centralOffset), 48);
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(ZIP64_LOCATOR, 0);
  locator.writeBigUInt64LE(BigInt(recordOffset), 8);
  locator.writeUInt32LE(1, 16);
  return Buffer.concat([record, locator]);
}
