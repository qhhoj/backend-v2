import { renderMarkdown, renderMath } from './markdown';

const full = (text: string) => renderMarkdown(text, 'problem-full');
const KATEX_INLINE = /^<p>a <span class="katex">.*<\/span> b<\/p>\n$/s;

describe('renderMarkdown', () => {
  it('renders inline, display and tilde math with KaTeX', () => {
    expect(full('a $x^2$ b')).toMatch(KATEX_INLINE);
    expect(full('a $x^2$ b')).toContain(
      '<annotation encoding="application/x-tex">x^2</annotation>',
    );
    expect(full('a $$\\sum_i x_i$$ b')).toContain(
      '<span class="katex-display">',
    );
    expect(full('$$\n\\begin{pmatrix} 1 \\\\ 2 \\end{pmatrix}\n$$')).toContain(
      '<span class="katex-display">',
    );
    expect(full('a ~x_i~ b')).toMatch(KATEX_INLINE);
  });
  it('keeps money, escapes and code literal', () => {
    expect(full('cost $5 and $10 dollars')).toBe(
      '<p>cost $5 and $10 dollars</p>\n',
    );
    expect(full('esc \\$x\\$ y')).toBe('<p>esc $x$ y</p>\n');
    expect(full('`$x$` and $y$')).toMatch(
      /^<p><code>\$x\$<\/code> and <span class="katex">/,
    );
    expect(full('```cpp\nint $x = 1;\n```')).toBe(
      '<pre><code class="language-cpp">int $x = 1;\n</code></pre>\n',
    );
    expect(full('$ x$ and $x $')).toBe('<p>$ x$ and $x $</p>\n');
  });
  it('lets a code span win over a math span that would cross it', () => {
    expect(full('cost $5, see `$x$` here')).toBe(
      '<p>cost $5, see <code>$x$</code> here</p>\n',
    );
  });
  it('does not close a math span on an escaped dollar', () => {
    expect(full('a $x\\$ b')).toBe('<p>a $x$ b</p>\n');
  });
  it('keeps strikethrough separate from tilde math', () => {
    expect(full('~~strike~~ and ~~a~b~~')).toBe(
      '<p><s>strike</s> and <s>a~b</s></p>\n',
    );
  });
  it('renders unknown macros as math-error spans with the raw TeX', () => {
    expect(full('p $\\foo$ q')).toBe(
      '<p>p <span class="math-error" title="KaTeX parse error: Undefined control sequence: \\foo at position 1: \\̲f̲o̲o̲">$\\foo$</span> q</p>\n',
    );
    expect(renderMath('\\href{javascript:alert(1)}{x}', false)).not.toMatch(
      /<a\b/,
    );
  });
  it('shifts headers by two, capped at h6, and wraps tables', () => {
    expect(full('# T\n\n###### six')).toBe('<h3>T</h3>\n<h6>six</h6>\n');
    expect(full('| a |\n|---|\n| 1 |')).toBe(
      '<div class="h-scrollable-table"><table class="table">\n<thead>\n<tr>\n<th>a</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>1</td>\n</tr>\n</tbody>\n</table></div>\n',
    );
    expect(full('<table><tr><td>raw</td></tr></table>')).toBe(
      '<div class="h-scrollable-table"><table class="table"><tr><td>raw</td></tr></table></div>',
    );
  });
  it('renders spoilers as spoiler blockquotes', () => {
    expect(full('>! hidden\n>! more\n\n> quote')).toBe(
      '<blockquote class="spoiler">\n<p>hidden\nmore</p>\n</blockquote>\n<blockquote>\n<p>quote</p>\n</blockquote>\n',
    );
  });
  it('adds nofollow/_blank to non-fragment links and leaves raw anchors alone', () => {
    expect(
      full('[link](http://x.test) [foot](#a) <a href="http://y.test">raw</a>'),
    ).toBe(
      '<p><a href="http://x.test" rel="nofollow noopener" target="_blank">link</a> <a href="#a">foot</a> <a href="http://y.test">raw</a></p>\n',
    );
  });
  it('links user references', () => {
    expect(full('see [user:alice], [ruser:bob] and [user:bad name]')).toBe(
      '<p>see <a class="user-reference" href="/user/alice">alice</a>, <a class="user-reference user-rating" href="/user/bob">bob</a> and [user:bad name]</p>\n',
    );
  });
  it('applies smart quotes, dashes and ellipses but not (c) or +-', () => {
    expect(full('"quotes" -- --- ... (c) +- x+-y `--`')).toBe(
      '<p>“quotes” – — … (c) +- x+-y <code>--</code></p>\n',
    );
    expect(full('Bài toán "Tính tổng" --- xong')).toBe(
      '<p>Bài toán “Tính tổng” — xong</p>\n',
    );
  });
  it('keeps raw HTML in problem-full and sanitizes it in problem/solution', () => {
    const raw =
      '<div style="color:red" onclick="x()">raw <script>1</script><b>html</b></div>';
    expect(full(raw)).toBe(raw);
    expect(renderMarkdown(raw, 'problem')).toBe(
      '<div style="color:red">raw <b>html</b></div>',
    );
    expect(renderMarkdown(raw, 'solution')).toBe(
      '<div style="color:red">raw <b>html</b></div>',
    );
  });
});
