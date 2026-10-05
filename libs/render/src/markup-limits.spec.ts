import { isMarkupWithinLimits } from './markup-limits';

const limits = { maxTags: 10, maxDepth: 3, mode: 'xml' as const };
const htmlLimits = { ...limits, mode: 'html' as const };

describe('isMarkupWithinLimits', () => {
  it('accepts markup within both limits', () => {
    expect(isMarkupWithinLimits('<a><b></b><c/><br></a>', limits)).toBe(true);
  });
  it('rejects too many tags', () => {
    expect(isMarkupWithinLimits('<i></i>'.repeat(6), limits)).toBe(false);
  });
  it('rejects nesting past maxDepth but not void or self-closed tags', () => {
    expect(isMarkupWithinLimits('<a><b><c><d>', limits)).toBe(false);
    expect(isMarkupWithinLimits('<a><b><c><br><hr><img src=x/>', limits)).toBe(
      true,
    );
  });
  it('rejects an unterminated tag', () => {
    expect(isMarkupWithinLimits('<a', limits)).toBe(false);
  });
  it('ignores stray closing tags and text that only looks like a tag', () => {
    expect(
      isMarkupWithinLimits('</p></p></p></p> a < b <!-- x -->', limits),
    ).toBe(true);
  });
  it('honours "/>" on any tag in xml mode only', () => {
    expect(isMarkupWithinLimits('<a/>'.repeat(5), limits)).toBe(true);
    expect(isMarkupWithinLimits('<a/>'.repeat(5), htmlLimits)).toBe(false);
    expect(isMarkupWithinLimits('<a />'.repeat(5), htmlLimits)).toBe(false);
  });
  it('honours "/>" inside svg and math in html mode', () => {
    expect(
      isMarkupWithinLimits(
        '<svg><path/><path/><path/><path/></svg>',
        htmlLimits,
      ),
    ).toBe(true);
    expect(
      isMarkupWithinLimits('<svg></svg><a/><a/><a/><a/>', htmlLimits),
    ).toBe(false);
  });
  it('does not treat "/>" inside an attribute value as self-closing in html mode', () => {
    expect(
      isMarkupWithinLimits(
        '<a title="/>"><b title="/>"><c title="/>"><d>',
        htmlLimits,
      ),
    ).toBe(false);
  });
  it('parses shallow markup in linear time and aborts deep markup early', () => {
    const run = (markup: string) => {
      const started = performance.now();
      isMarkupWithinLimits(markup, {
        maxTags: 1e9,
        maxDepth: 500,
        mode: 'html',
      });
      return performance.now() - started;
    };
    run('<p>x</p>'.repeat(10000));
    const ratio =
      run('<p>x</p>'.repeat(250000)) /
      Math.max(run('<p>x</p>'.repeat(50000)), 1);
    expect(ratio).toBeLessThan(15);
    // Same byte size: without the early abort at depth 500 the two take equally long.
    const flat = '<p>x</p>'.repeat(250000);
    expect(run(`${'<a>'.repeat(501)}${flat}`)).toBeLessThan(run(flat) / 2);
  });
});
