import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BridgeMessage,
  Chunk,
  FetchSourceRequest,
  JudgeMessage,
} from './index';
import { PROTO_ROOT } from './proto-root';

const GOLDEN = join(PROTO_ROOT, 'golden');
const CODECS = {
  JudgeMessage,
  BridgeMessage,
  FetchSourceRequest,
  Chunk,
} as const;
type CodecName = keyof typeof CODECS;

interface Fixture {
  type: CodecName;
  message: unknown;
}

const names = readdirSync(GOLDEN)
  .filter((file) => file.endsWith('.json'))
  .map((file) => file.slice(0, -'.json'.length))
  .sort();
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(GOLDEN, `${name}.json`), 'utf8')) as Fixture;
const bytesOf = (name: string) =>
  new Uint8Array(readFileSync(join(GOLDEN, `${name}.bin`)));

describe('golden fixtures from judge-v2', () => {
  it('has the fixtures the Rust side wrote', () => {
    expect(names).toEqual(
      expect.arrayContaining([
        'judge-hello',
        'judge-cases',
        'bridge-welcome',
        'bridge-assign-inline',
        'chunk',
      ]),
    );
  });

  it.each(names)('%s: the Rust bytes decode to the JSON message', (name) => {
    const { type, message } = fixture(name);
    const codec = CODECS[type] as typeof JudgeMessage;
    const decoded = codec.decode(bytesOf(name));
    expect(decoded).toEqual(codec.fromJSON(message));
    expect(codec.decode(codec.encode(decoded).finish())).toEqual(decoded);
  });

  it('keeps a present zero contest number apart from an absent one', () => {
    const live = BridgeMessage.decode(bytesOf('bridge-assign-contest-live'));
    const outside = BridgeMessage.decode(bytesOf('bridge-assign-inline'));
    const metaOf = (message: BridgeMessage) =>
      message.body?.$case === 'assign' ? message.body.assign.meta : undefined;
    expect(metaOf(live)?.inContest).toBe(0);
    expect(metaOf(outside)?.inContest).toBeUndefined();
  });

  it('reads the largest exact 64-bit value as a safe number', () => {
    const final = JudgeMessage.decode(bytesOf('judge-final-graded'));
    expect(
      final.body?.$case === 'final' && final.body.final.dataVersionUsed,
    ).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('skips a field number it does not know (a newer minor)', () => {
    const known = bytesOf('bridge-ack');
    // field 15, wire type 0 (varint), value 1
    const withUnknown = new Uint8Array([...known, 0x78, 0x01]);
    expect(BridgeMessage.decode(withUnknown)).toEqual(
      BridgeMessage.decode(known),
    );
  });
});
