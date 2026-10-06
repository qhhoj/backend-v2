import { deflateSync, inflateSync } from 'node:zlib';
import { ProtocolError } from './protocol.error';

/** Legacy `MAX_ALLOWED_PACKET_SIZE`: the compressed body a 4-byte header may announce. */
export const MAX_PACKET_BYTES = 8 * 1024 * 1024;
/** Inflation stops here (zlib bomb); a judge's largest real packet, a test-case batch, is far smaller. */
export const MAX_INFLATED_BYTES = 32 * 1024 * 1024;
/** Caps for a connection that has not authenticated yet: only a handshake is legitimate. */
export const MAX_HANDSHAKE_PACKET_BYTES = 4 * 1024 * 1024;
export const MAX_HANDSHAKE_INFLATED_BYTES = 16 * 1024 * 1024;
/** Compressed and inflated byte caps for one frame. */
export interface FrameLimits {
  packetBytes: number;
  inflatedBytes: number;
}
export const JUDGE_LIMITS: FrameLimits = {
  packetBytes: MAX_PACKET_BYTES,
  inflatedBytes: MAX_INFLATED_BYTES,
};
export const HANDSHAKE_LIMITS: FrameLimits = {
  packetBytes: MAX_HANDSHAKE_PACKET_BYTES,
  inflatedBytes: MAX_HANDSHAKE_INFLATED_BYTES,
};
/** The deepest real packet is a handshake at depth 5; V8's iterative `JSON.parse` takes seconds on deeper hostile input. */
export const MAX_JSON_DEPTH = 16;
const HEADER_BYTES = 4;
const utf8 = new TextDecoder('utf-8', { fatal: true });

export type Packet = { name: string } & Record<string, unknown>;

/** 4-byte big-endian length + zlib-compressed JSON (legacy `ZlibPacketHandler.send`). */
export function encodePacket(packet: Packet): Buffer {
  const body = deflateSync(Buffer.from(JSON.stringify(packet), 'utf8'));
  const header = Buffer.alloc(HEADER_BYTES);
  header.writeUInt32BE(body.length);
  return Buffer.concat([header, body]);
}

/** Splits every complete frame off the front of `pending`; a partial frame stays in `rest`. A header announcing more than `limits.packetBytes` throws before its body is buffered. */
export function readFrames(
  pending: Buffer,
  limits: FrameLimits,
): { frames: Buffer[]; rest: Buffer } {
  const frames: Buffer[] = [];
  let offset = 0;
  while (pending.length - offset >= HEADER_BYTES) {
    const size = pending.readUInt32BE(offset);
    if (size > limits.packetBytes)
      throw new ProtocolError(
        `Packet of ${size} bytes exceeds ${limits.packetBytes}`,
      );
    if (pending.length - offset - HEADER_BYTES < size) break;
    frames.push(
      pending.subarray(offset + HEADER_BYTES, offset + HEADER_BYTES + size),
    );
    offset += HEADER_BYTES + size;
  }
  return { frames, rest: pending.subarray(offset) };
}

/** One O(n) pass: throws when brackets nest deeper than `MAX_JSON_DEPTH`, skipping strings and their escapes. Residual: wide-but-shallow JSON still costs `JSON.parse` seconds, bounded by the inflated cap. */
function assertShallow(json: string): void {
  let depth = 0;
  let inString = false;
  for (let index = 0; index < json.length; index++) {
    const char = json[index];
    if (inString) {
      if (char === '\\') index++;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '[' || char === '{') {
      if (++depth > MAX_JSON_DEPTH)
        throw new ProtocolError(`Packet nested deeper than ${MAX_JSON_DEPTH}`);
    } else if (char === ']' || char === '}') depth--;
  }
}

/** Inflates (bounded by `limits.inflatedBytes`), decodes strict UTF-8, refuses deep nesting and parses a JSON object with a string `name`. */
export function decodeFrame(frame: Buffer, limits: FrameLimits): Packet {
  let value: unknown;
  try {
    const json = utf8.decode(
      inflateSync(frame, { maxOutputLength: limits.inflatedBytes }),
    );
    assertShallow(json);
    value = JSON.parse(json);
  } catch (error) {
    throw new ProtocolError(`Undecodable packet: ${(error as Error).message}`);
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    typeof (value as { name?: unknown }).name !== 'string'
  )
    throw new ProtocolError('Packet is not an object with a name');
  return value as Packet;
}
