import { SHORT_CODE_ALPHABET, SHORT_CODE_LENGTH } from '@libs/database';
import {
  isReservedShortCode,
  randomShortCode,
  RESERVED_SHORT_CODES,
} from './short-code';

describe('randomShortCode', () => {
  it('draws one alphabet symbol per position from the picker', () => {
    let next = 0;
    const code = randomShortCode(() => next++);
    expect(code).toBe(SHORT_CODE_ALPHABET.slice(0, SHORT_CODE_LENGTH));
  });
  it('asks the picker for an index below the alphabet size', () => {
    const limits = new Set<number>();
    randomShortCode((limit) => {
      limits.add(limit);
      return 0;
    });
    expect([...limits]).toEqual([SHORT_CODE_ALPHABET.length]);
  });
  it('only ever uses unambiguous symbols and the right length', () => {
    for (let index = 0; index < 500; index += 1) {
      const code = randomShortCode();
      expect(code).toHaveLength(SHORT_CODE_LENGTH);
      expect(code).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]+$/);
    }
  });
  it('cannot generate a reserved word', () => {
    for (const word of RESERVED_SHORT_CODES.filter(
      (entry) => entry.length === SHORT_CODE_LENGTH,
    ))
      expect(
        [...word].some((letter) => !SHORT_CODE_ALPHABET.includes(letter)),
      ).toBe(true);
  });
});

describe('isReservedShortCode', () => {
  it('knows the reserved words', () => {
    expect(isReservedShortCode('admin')).toBe(true);
    expect(isReservedShortCode('round1')).toBe(false);
  });
});
