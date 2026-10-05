import { crc32 } from 'node:zlib';

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
}

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_RECORD = 0x06054b50;
const MADE_BY_UNIX = 0x031e;
const UTF8_NAMES_FLAG = 0x0800;
const REGULAR_FILE = 0o100644;
const SYMLINK = 0o120777;

/** Hand-written stored (method 0) zip: tests need names and attributes real zip writers refuse (`..`, absolute paths, symlinks, lying sizes). Fewer than 65535 entries. */
export function buildZip(entries: ZipTestEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const content = Buffer.isBuffer(entry.content)
      ? entry.content
      : Buffer.from(entry.content ?? '', 'utf8');
    const declared = entry.declaredSize ?? content.length;
    const checksum = crc32(content);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(LOCAL_HEADER, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8_NAMES_FLAG, 6);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(declared, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(CENTRAL_HEADER, 0);
    central.writeUInt16LE(MADE_BY_UNIX, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(UTF8_NAMES_FLAG, 8);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(declared, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(
      ((entry.symlink ? SYMLINK : REGULAR_FILE) << 16) >>> 0,
      38,
    );
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    locals.push(local, content);
    centrals.push(central);
    offset += local.length + content.length;
  }
  const centralSize = centrals.reduce((sum, buffer) => sum + buffer.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_RECORD, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}
