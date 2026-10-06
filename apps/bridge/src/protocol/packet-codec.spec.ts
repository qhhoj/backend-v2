import { deflateSync } from 'node:zlib';
import { frameOf } from '../../test/fake-judge';
import {
  decodeFrame,
  HANDSHAKE_LIMITS,
  JUDGE_LIMITS,
  MAX_JSON_DEPTH,
  encodePacket,
  MAX_INFLATED_BYTES,
  MAX_PACKET_BYTES,
  readFrames,
} from './packet-codec';
import type { Packet } from './packet-codec';
import { ProtocolError } from './protocol.error';

const framesOf = (bytes: Buffer) => readFrames(bytes, JUDGE_LIMITS);
const decodeJudge = (frame: Buffer) => decodeFrame(frame, JUDGE_LIMITS);
const decodeAll = (bytes: Buffer): Packet[] =>
  framesOf(bytes).frames.map(decodeJudge);

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
      const { frames, rest } = framesOf(
        Buffer.concat([pending, Buffer.from([byte])]),
      );
      packets.push(...frames.map(decodeJudge));
      pending = rest;
    }
    expect(packets).toEqual([ping, unicode]);
    expect(pending).toHaveLength(0);
  });
  it('splits coalesced packets and keeps a trailing partial one', () => {
    const third = encodePacket({ name: 'grading-end', 'submission-id': 'x' });
    const partial = third.subarray(0, third.length - 3);
    const { frames, rest } = framesOf(
      Buffer.concat([encodePacket(ping), encodePacket(unicode), partial]),
    );
    expect(frames.map(decodeJudge)).toEqual([ping, unicode]);
    expect(rest.equals(partial)).toBe(true);
    expect(
      framesOf(
        Buffer.concat([rest, third.subarray(third.length - 3)]),
      ).frames.map(decodeJudge),
    ).toEqual([{ name: 'grading-end', 'submission-id': 'x' }]);
  });
  it('waits for a body of exactly the maximum size and refuses one byte more before buffering it', () => {
    const header = Buffer.alloc(4);
    header.writeUInt32BE(MAX_PACKET_BYTES);
    expect(framesOf(header).frames).toEqual([]);
    header.writeUInt32BE(MAX_PACKET_BYTES + 1);
    expect(() => framesOf(header)).toThrow(ProtocolError);
  });
  it.each([
    ['bad zlib', Buffer.from('definitely not zlib')],
    [
      'invalid UTF-8 (valid JSON once leniently decoded)',
      deflateSync(
        Buffer.concat([
          Buffer.from('{"name":"'),
          Buffer.from([0xff]),
          Buffer.from('"}'),
        ]),
      ),
    ],
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
    header.writeUInt32BE(HANDSHAKE_LIMITS.packetBytes + 1);
    expect(() => readFrames(header, HANDSHAKE_LIMITS)).toThrow(ProtocolError);
    expect(framesOf(header).frames).toEqual([]);
    const padded = deflateSync(
      Buffer.concat([
        Buffer.from('{"name":"x"}'),
        Buffer.alloc(HANDSHAKE_LIMITS.inflatedBytes, 0x20),
      ]),
    );
    expect(decodeJudge(padded).name).toBe('x');
    expect(() => decodeFrame(padded, HANDSHAKE_LIMITS)).toThrow(ProtocolError);
  });
  describe('nesting depth', () => {
    const nested = (depth: number, tail = '') =>
      deflateSync(
        Buffer.from(
          `{"name":"x","a":${'['.repeat(depth)}${']'.repeat(depth)}${tail}}`,
        ),
      );
    it('accepts the nesting a real packet has and refuses deeper', () => {
      expect(decodeJudge(nested(MAX_JSON_DEPTH - 1)).name).toBe('x');
      expect(() => decodeJudge(nested(MAX_JSON_DEPTH))).toThrow(ProtocolError);
    });
    it('ignores brackets and escaped quotes inside strings', () => {
      const text = JSON.stringify({
        name: 'x',
        log: '[[[[{{{{ \\" [[[[[[[[[[[[[[[[[[[[',
      });
      expect(decodeJudge(deflateSync(Buffer.from(text))).name).toBe('x');
    });
    it('refuses a pathologically nested frame fast under the handshake caps', () => {
      const depth = HANDSHAKE_LIMITS.inflatedBytes / 2 - 20;
      const started = Date.now();
      expect(() => decodeFrame(nested(depth), HANDSHAKE_LIMITS)).toThrow(
        ProtocolError,
      );
      expect(Date.now() - started).toBeLessThan(1000);
    });
  });
});
