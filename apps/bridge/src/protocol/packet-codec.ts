import { deflateSync, inflateSync } from 'node:zlib';
import { ProtocolError } from './protocol.error';

/** Legacy `MAX_ALLOWED_PACKET_SIZE`: the compressed body a 4-byte header may announce. */
export const MAX_PACKET_BYTES = 8 * 1024 * 1024;
/** Inflation stops here (zlib bomb); a judge's largest real packet, a test-case batch, is far smaller. */
export const MAX_INFLATED_BYTES = 32 * 1024 * 1024;
/** Caps for a connection that has not authenticated yet: only a handshake is legitimate. */
export const MAX_HANDSHAKE_PACKET_BYTES = 4 * 1024 * 1024;
export const MAX_HANDSHAKE_INFLATED_BYTES = 16 * 1024 * 1024;
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

/** Splits every complete frame off the front of `pending`; a partial frame stays in `rest`. A header announcing more than `maxPacketBytes` throws before its body is buffered. */
export function readFrames(
  pending: Buffer,
  maxPacketBytes = MAX_PACKET_BYTES,
): { frames: Buffer[]; rest: Buffer } {
  const frames: Buffer[] = [];
  let offset = 0;
  while (pending.length - offset >= HEADER_BYTES) {
    const size = pending.readUInt32BE(offset);
    if (size > maxPacketBytes)
      throw new ProtocolError(
        `Packet of ${size} bytes exceeds ${maxPacketBytes}`,
      );
    if (pending.length - offset - HEADER_BYTES < size) break;
    frames.push(
      pending.subarray(offset + HEADER_BYTES, offset + HEADER_BYTES + size),
    );
    offset += HEADER_BYTES + size;
  }
  return { frames, rest: pending.subarray(offset) };
}

/** Inflates (bounded by `maxInflatedBytes`), decodes strict UTF-8 and parses a JSON object with a string `name`. */
export function decodeFrame(
  frame: Buffer,
  maxInflatedBytes = MAX_INFLATED_BYTES,
): Packet {
  let value: unknown;
  try {
    value = JSON.parse(
      utf8.decode(inflateSync(frame, { maxOutputLength: maxInflatedBytes })),
    );
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
