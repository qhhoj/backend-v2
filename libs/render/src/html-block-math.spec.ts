import { renderHtmlBlockMath } from './html-block-math';

const formula = (tex: string) => `[${tex}]`;

describe('renderHtmlBlockMath', () => {
  it.each([
    ['tags that never close', '<a '],
    ['quotes that never close', '<a x="'],
    ['comments that never close', '<!--'],
  ])('scans 200 KB of %s in linear time', (_case, unit) => {
    const run = unit.repeat(200_000 / unit.length);
    const started = performance.now();
    const html = renderHtmlBlockMath(`<div>${run}$x$`, formula);
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(html).toBe(`<div>${run}[x]`);
  });

  it('ends a tag at the first unquoted > after a failed scan', () => {
    expect(renderHtmlBlockMath('<a "$x$ <b>$y$', formula)).toBe(
      '<a "[x] <b>[y]',
    );
    expect(renderHtmlBlockMath('<a title="$x$"> $y$', formula)).toBe(
      '<a title="$x$"> [y]',
    );
  });
});
