import { GIF, JPG, PDF, PNG, SVG } from './testing';
import { isSvgWithinLimits, sniffImage } from './file-sniff';

describe('file sniffing', () => {
  it.each([
    ['png', PNG],
    ['jpg', JPG],
    ['gif', GIF],
    ['svg', SVG],
  ])('detects %s', (kind, content) => expect(sniffImage(content)).toBe(kind));
  it.each([
    Buffer.from('hello'),
    PDF,
    Buffer.from('<html><svg></svg></html>'),
    Buffer.alloc(0),
  ])('rejects non-images', (content) => expect(sniffImage(content)).toBeNull());
  it('rejects a comment flood without catastrophic backtracking', () => {
    const started = Date.now();
    expect(
      sniffImage(Buffer.from('<!-- x -->'.repeat(200) + '<html>')),
    ).toBeNull();
    expect(Date.now() - started).toBeLessThan(100);
  });
});

describe('isSvgWithinLimits', () => {
  const timed = (svg: string) => {
    const started = Date.now();
    const result = isSvgWithinLimits(svg);
    expect(Date.now() - started).toBeLessThan(200);
    return result;
  };
  it('accepts ordinary svg', () => expect(timed(SVG.toString())).toBe(true));
  it('rejects too many tags, deep nesting but not self-closing siblings', () => {
    expect(timed('<svg>' + '<g></g>'.repeat(10001) + '</svg>')).toBe(false);
    expect(timed('<g>'.repeat(1001))).toBe(false);
    expect(timed('<g>'.repeat(1000) + '</g>'.repeat(1000))).toBe(true);
    expect(timed('<rect/>'.repeat(5000))).toBe(true);
  });
  it('counts every parser-visible element name, not just letters', () => {
    expect(timed('<_>'.repeat(20001))).toBe(false);
    expect(timed('<:a>'.repeat(1001))).toBe(false);
    expect(timed('<1>'.repeat(1001))).toBe(false);
    expect(timed('<é>'.repeat(1001))).toBe(false);
  });
  it.each(['\u00A0', '\uFEFF', '\u2028', '\u000B'])(
    'counts a tag opened by the non-parser-whitespace char %j',
    (character) => expect(timed(`<${character}>`.repeat(20001))).toBe(false),
  );
  it('rejects an unterminated tag', () => expect(timed('<svg><g')).toBe(false));
});
