import { clipBytes } from './clip-bytes';

describe('clipBytes', () => {
  it('keeps short text', () => expect(clipBytes('abc', 5)).toBe('abc'));
  it('never splits a multi-byte character', () => {
    const clipped = clipBytes('é'.repeat(300), 511);
    expect(Buffer.byteLength(clipped)).toBe(510);
    expect(clipped).toBe('é'.repeat(255));
  });
});
