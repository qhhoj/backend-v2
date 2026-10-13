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
  /** Lies about where the local header starts. */
  localHeaderOffset?: number;
  /** Lies about the compressed size in the central directory. */
  declaredCompressedSize?: number;
}

export interface ZipTestOptions {
  /** Lies about the entry count in the end-of-central-directory record. */
  declaredEntryCount?: number;
  /** Writes a zip64 end record and locator, as Info-ZIP does when streaming from stdin. */
  zip64?: boolean;
  /** With `zip64`: lies about the zip64 end record offset in the locator. */
  zip64RecordOffset?: bigint;
  /** With `zip64`: lies about the central directory offset in the zip64 end record. */
  zip64CentralOffset?: bigint;
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

/** An entry's bytes and header values once its test overrides are applied. */
interface ResolvedEntry {
  name: Buffer;
  data: Buffer;
  method: number;
  flags: number;
  declaredSize: number;
  checksum: number;
  centralExtra: Buffer;
}
/** Where the central directory sits, for the end records. */
interface ZipLayout {
  count: number;
  centralSize: number;
  centralOffset: number;
  recordOffset: number;
}

function resolveEntry(entry: ZipTestEntry): ResolvedEntry {
  const content = Buffer.isBuffer(entry.content)
    ? entry.content
    : Buffer.from(entry.content ?? '', 'utf8');
  const isDeflated = entry.method === 'deflate';
  return {
    name: Buffer.from(entry.name, 'utf8'),
    data: entry.data ?? (isDeflated ? deflateRawSync(content) : content),
    method: entry.methodNumber ?? (isDeflated ? METHOD_DEFLATE : METHOD_STORE),
    flags: UTF8_NAMES_FLAG | (entry.encrypted ? ENCRYPTED_FLAG : 0),
    declaredSize: entry.declaredSize ?? content.length,
    checksum: entry.checksum ?? crc32(content),
    centralExtra: entry.centralExtra ?? Buffer.alloc(0),
  };
}

function localHeader(resolved: ResolvedEntry): Buffer {
  const header = Buffer.alloc(30 + resolved.name.length);
  header.writeUInt32LE(LOCAL_HEADER, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(resolved.flags, 6);
  header.writeUInt16LE(resolved.method, 8);
  header.writeUInt32LE(resolved.checksum, 14);
  header.writeUInt32LE(resolved.data.length, 18);
  header.writeUInt32LE(resolved.declaredSize, 22);
  header.writeUInt16LE(resolved.name.length, 26);
  resolved.name.copy(header, 30);
  return header;
}

function centralHeader(
  entry: ZipTestEntry,
  resolved: ResolvedEntry,
  localOffset: number,
): Buffer {
  const { name, centralExtra } = resolved;
  const header = Buffer.alloc(46 + name.length + centralExtra.length);
  header.writeUInt32LE(CENTRAL_HEADER, 0);
  header.writeUInt16LE(MADE_BY_UNIX, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(resolved.flags, 8);
  header.writeUInt16LE(resolved.method, 10);
  header.writeUInt32LE(resolved.checksum, 16);
  header.writeUInt32LE(
    entry.declaredCompressedSize ?? resolved.data.length,
    20,
  );
  header.writeUInt32LE(resolved.declaredSize, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(centralExtra.length, 30);
  header.writeUInt32LE(
    ((entry.symlink ? SYMLINK : REGULAR_FILE) << 16) >>> 0,
    38,
  );
  header.writeUInt32LE(entry.localHeaderOffset ?? localOffset, 42);
  name.copy(header, 46);
  centralExtra.copy(header, 46 + name.length);
  return header;
}

function endRecord(layout: ZipLayout, options: ZipTestOptions): Buffer {
  const record = Buffer.alloc(22);
  record.writeUInt32LE(END_RECORD, 0);
  record.writeUInt16LE(options.zip64 ? 0xffff : layout.count, 8);
  record.writeUInt16LE(options.zip64 ? 0xffff : layout.count, 10);
  record.writeUInt32LE(layout.centralSize, 12);
  record.writeUInt32LE(options.zip64 ? 0xffffffff : layout.centralOffset, 16);
  return record;
}

/** Hand-written zip: tests need names, attributes and sizes real zip writers refuse (`..`, absolute paths, symlinks, lying sizes). Fewer than 65535 entries. */
export function buildZip(
  entries: ZipTestEntry[],
  options: ZipTestOptions = {},
): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const resolved = resolveEntry(entry);
    const local = localHeader(resolved);
    locals.push(local, resolved.data);
    centrals.push(centralHeader(entry, resolved, offset));
    offset += local.length + resolved.data.length;
  }
  const centralSize = centrals.reduce((sum, buffer) => sum + buffer.length, 0);
  const layout: ZipLayout = {
    count: options.declaredEntryCount ?? entries.length,
    centralSize,
    centralOffset: offset,
    recordOffset: offset + centralSize,
  };
  const zip64 = options.zip64 ? zip64Tail(layout, options) : Buffer.alloc(0);
  return Buffer.concat([
    ...locals,
    ...centrals,
    zip64,
    endRecord(layout, options),
  ]);
}

const ZIP64_RECORD = 0x06064b50;
const ZIP64_LOCATOR = 0x07064b50;

/** The zip64 end-of-central-directory record followed by its locator. */
function zip64Tail(layout: ZipLayout, options: ZipTestOptions): Buffer {
  const record = Buffer.alloc(56);
  record.writeUInt32LE(ZIP64_RECORD, 0);
  record.writeBigUInt64LE(44n, 4);
  record.writeUInt16LE(45, 12);
  record.writeUInt16LE(45, 14);
  record.writeBigUInt64LE(BigInt(layout.count), 24);
  record.writeBigUInt64LE(BigInt(layout.count), 32);
  record.writeBigUInt64LE(BigInt(layout.centralSize), 40);
  record.writeBigUInt64LE(
    options.zip64CentralOffset ?? BigInt(layout.centralOffset),
    48,
  );
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(ZIP64_LOCATOR, 0);
  locator.writeBigUInt64LE(
    options.zip64RecordOffset ?? BigInt(layout.recordOffset),
    8,
  );
  locator.writeUInt32LE(1, 16);
  return Buffer.concat([record, locator]);
}

/** What a fake Polygon method answers: an OK `result`, a FAILED `comment` (with Polygon's HTTP status and type), a package zip, or an HTTP error page. */
export type FakePolygonReply =
  | { result: unknown }
  | { failed: string; status?: number; contentType?: string }
  | { zip: Buffer }
  | { status: number; page?: string; contentType?: string };

/** A stand-in for Polygon's HTTP API, given to the client as its `fetch`; it records every call's method and form fields. */
export class FakePolygon {
  readonly calls: Array<{ method: string; params: Record<string, string> }> =
    [];
  private replies = new Map<
    string,
    (params: Record<string, string>) => FakePolygonReply
  >();

  reply(
    method: string,
    answer:
      FakePolygonReply | ((params: Record<string, string>) => FakePolygonReply),
  ): this {
    this.replies.set(
      method,
      typeof answer === 'function' ? answer : () => answer,
    );
    return this;
  }

  callsOf(method: string) {
    return this.calls.filter((call) => call.method === method);
  }

  reset(): void {
    this.calls.length = 0;
    this.replies.clear();
  }

  readonly fetch = (
    url: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const href = url instanceof Request ? url.url : url.toString();
    const method = href.split('/api/')[1];
    const params = Object.fromEntries(
      new URLSearchParams(init?.body as URLSearchParams | undefined),
    );
    this.calls.push({ method, params });
    const reply = this.replies.get(method)?.(params) ?? {
      failed: `fake: no reply for ${method}`,
    };
    return Promise.resolve(responseOf(reply));
  };
}

const responseOf = (reply: FakePolygonReply): Response => {
  if ('zip' in reply)
    return new Response(new Uint8Array(reply.zip), {
      headers: {
        'content-type': 'application/zip',
        'content-length': String(reply.zip.length),
      },
    });
  if ('status' in reply && !('failed' in reply))
    return new Response(reply.page ?? 'busy', {
      status: reply.status,
      headers: { 'content-type': reply.contentType ?? 'text/plain' },
    });
  if ('failed' in reply)
    return new Response(
      JSON.stringify({ status: 'FAILED', comment: reply.failed }),
      {
        status: reply.status ?? 400,
        headers: { 'content-type': reply.contentType ?? 'application/json' },
      },
    );
  return new Response(JSON.stringify({ status: 'OK', result: reply.result }), {
    headers: { 'content-type': 'application/json' },
  });
};
