import { hasControlCharacter } from './control-characters';

describe('hasControlCharacter', () => {
  it.each([
    ['plain text', false],
    ['', false],
    ['tab\there', true],
    ['line\nbreak', true],
    ['null\u0000byte', true],
    ['del\u007f', true],
    ['\u001f', true],
    [' ', false],
    ['é😀', false],
    ['\u0080', false],
  ])('%j: %s', (text, expected) =>
    expect(hasControlCharacter(text)).toBe(expected),
  );
});
