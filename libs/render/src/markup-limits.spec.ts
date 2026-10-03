import { isMarkupWithinLimits } from './markup-limits';

const limits = { maxTags: 10, maxDepth: 3 };

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
});
