import { SHORT_CODE_ALPHABET, SHORT_CODE_LENGTH } from '@libs/database';
import { randomShortCode, RESERVED_SHORT_CODES } from './short-code';

describe('randomShortCode', () => {
  it('only ever uses unambiguous symbols and the right length', () => {
    for (let index = 0; index < 100; index += 1) {
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
