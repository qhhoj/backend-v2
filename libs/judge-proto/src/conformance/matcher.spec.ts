import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROTO_ROOT } from '../proto-root';
import { mismatch } from './matcher';
import type { Json } from './matcher';

interface MatcherCase {
  why: string;
  expected: Json;
  actual: Json;
  matches: boolean;
}

describe('conformance matcher', () => {
  const cases = JSON.parse(
    readFileSync(join(PROTO_ROOT, 'conformance', 'matcher-cases.json'), 'utf8'),
  ) as MatcherCase[];

  it.each(cases.map((testCase) => [testCase.why, testCase]))(
    '%s',
    (_why, testCase) => {
      const found = mismatch(testCase.expected, testCase.actual);
      expect(found === null).toBe(testCase.matches);
    },
  );

  it('names the path of the first difference', () => {
    expect(mismatch({ ack: { seq: 3 } }, { ack: { seq: 2 } })).toMatch(
      /^\$\.ack\.seq: /,
    );
  });

  it('needs a present value for a star and a present message for any expectation', () => {
    expect(mismatch({ welcome: { sessionId: '*' } }, { welcome: {} })).toMatch(
      /^\$\.welcome\.sessionId: expected a value/,
    );
    expect(
      mismatch(
        { final: { reason: 'RETRY_REASON_UNSPECIFIED' } },
        { accepted: {} },
      ),
    ).toMatch(/^\$\.final: expected this message/);
    expect(mismatch({ ack: {} }, null)).toMatch(
      /^\$\.ack: expected this message/,
    );
  });

  it('treats an absent and a null field alike', () => {
    expect(mismatch({ ack: { seq: 0 } }, { ack: {} })).toBeNull();
    expect(mismatch({ ack: { seq: 0 } }, { ack: { seq: null } })).toBeNull();
  });
});
