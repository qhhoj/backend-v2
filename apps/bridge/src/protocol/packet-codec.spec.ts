import { deflateSync } from 'node:zlib';
import { frameOf } from '../../test/frame-of';
import {
  decodeFrame,
  MAX_HANDSHAKE_INFLATED_BYTES,
  MAX_HANDSHAKE_PACKET_BYTES,
  encodePacket,
  MAX_INFLATED_BYTES,
  MAX_PACKET_BYTES,
  readFrames,
} from './packet-codec';
import type { Packet } from './packet-codec';
import { ProtocolError } from './protocol.error';

const decodeAll = (bytes: Buffer): Packet[] =>
  readFrames(bytes).frames.map((frame) => decodeFrame(frame));

describe('packet codec', () => {
  const ping: Packet = { name: 'ping-response', when: 1.5, load: 0.25 };
  const unicode: Packet = { name: 'compile-error', log: 'lỗi biên dịch ✗' };

  it('round-trips packets, unicode included', () =>
    expect(
      decodeAll(Buffer.concat([encodePacket(ping), encodePacket(unicode)])),
    ).toEqual([ping, unicode]));
  it('reassembles packets fed one byte at a time', () => {
    const bytes = Buffer.concat([encodePacket(ping), encodePacket(unicode)]);
    const packets: Packet[] = [];
    let pending: Buffer = Buffer.alloc(0);
    for (const byte of bytes) {
      const { frames, rest } = readFrames(
        Buffer.concat([pending, Buffer.from([byte])]),
      );
      packets.push(...frames.map((frame) => decodeFrame(frame)));
      pending = rest;
    }
    expect(packets).toEqual([ping, unicode]);
    expect(pending).toHaveLength(0);
  });
  it('splits coalesced packets and keeps a trailing partial one', () => {
    const third = encodePacket({ name: 'grading-end', 'submission-id': 'x' });
    const partial = third.subarray(0, third.length - 3);
    const { frames, rest } = readFrames(
      Buffer.concat([encodePacket(ping), encodePacket(unicode), partial]),
    );
    expect(frames.map((frame) => decodeFrame(frame))).toEqual([ping, unicode]);
    expect(rest.equals(partial)).toBe(true);
    expect(
      readFrames(
        Buffer.concat([rest, third.subarray(third.length - 3)]),
      ).frames.map((frame) => decodeFrame(frame)),
    ).toEqual([{ name: 'grading-end', 'submission-id': 'x' }]);
  });
  it('waits for a body of exactly the maximum size and refuses one byte more before buffering it', () => {
    const header = Buffer.alloc(4);
    header.writeUInt32BE(MAX_PACKET_BYTES);
    expect(readFrames(header).frames).toEqual([]);
    header.writeUInt32BE(MAX_PACKET_BYTES + 1);
    expect(() => readFrames(header)).toThrow(ProtocolError);
  });
  it.each([
    ['bad zlib', Buffer.from('definitely not zlib')],
    ['invalid UTF-8', deflateSync(Buffer.from([0x7b, 0xff, 0xfe, 0x7d]))],
    ['not JSON', deflateSync(Buffer.from('{name:'))],
    ['a JSON array', deflateSync(Buffer.from('["ping"]'))],
    ['an object without a name', deflateSync(Buffer.from('{"when":1}'))],
    ['a numeric name', deflateSync(Buffer.from('{"name":1}'))],
  ])('refuses %s', (_label, body) =>
    expect(() => decodeAll(frameOf(body))).toThrow(ProtocolError),
  );
  it('refuses a zlib bomb', () => {
    const bomb = deflateSync(Buffer.alloc(MAX_INFLATED_BYTES + 1, 0x20));
    expect(bomb.length).toBeLessThan(MAX_PACKET_BYTES);
    expect(() => decodeAll(frameOf(bomb))).toThrow(ProtocolError);
  });
  it('applies the smaller pre-handshake caps when given them', () => {
    const header = Buffer.alloc(4);
    header.writeUInt32BE(MAX_HANDSHAKE_PACKET_BYTES + 1);
    expect(() => readFrames(header, MAX_HANDSHAKE_PACKET_BYTES)).toThrow(
      ProtocolError,
    );
    expect(readFrames(header).frames).toEqual([]);
    const padded = deflateSync(
      Buffer.concat([
        Buffer.from('{"name":"x"}'),
        Buffer.alloc(MAX_HANDSHAKE_INFLATED_BYTES, 0x20),
      ]),
    );
    expect(decodeFrame(padded).name).toBe('x');
    expect(() => decodeFrame(padded, MAX_HANDSHAKE_INFLATED_BYTES)).toThrow(
      ProtocolError,
    );
  });
});
