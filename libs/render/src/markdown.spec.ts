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

  it('does not close a math span on an escaped dollar, but does after an even run of backslashes', () => {
    expect(full('a $x\\\\$ b')).toMatch(KATEX_INLINE);
  });
  it('lets tilde math keep inner spaces but not dollar math', () => {
    expect(full('a ~x \\leq 10 ~ b')).toMatch(KATEX_INLINE);
    expect(full('a ~ x ~ b')).toMatch(KATEX_INLINE);
    expect(full('a $x \\leq 10 $ b')).toBe('<p>a $x \\leq 10 $ b</p>\n');
  });
  it('catches every KaTeX failure into a truncated math-error span', () => {
    const nested = full(`$${'{'.repeat(20000)}${'}'.repeat(20000)}$`);
    const frac = full(`$${'\\frac{'.repeat(3000)}$`);
    for (const html of [nested, frac]) {
      expect(html).toContain('<span class="math-error"');
      expect(html.length).toBeLessThan(1000);
    }
    expect(renderMarkdown('$\\foo$', 'problem')).toContain(
      'title="KaTeX parse error: Undefined control sequence: \\foo',
    );
  });
  it('renders math input in linear time', () => {
    for (const text of ['$a '.repeat(50000), '$1 '.repeat(50000)]) {
      const started = Date.now();
      full(text);
      expect(Date.now() - started).toBeLessThan(500);
    }
  });
  it('stops treating >! as a spoiler beyond 20 levels instead of overflowing the stack', () => {
    const html = full('>! '.repeat(2000) + 'x');
    expect(html.match(/<blockquote class="spoiler">/g)).toHaveLength(20);
    expect(full('>! '.repeat(20) + 'x')).toContain('x');
    expect(() =>
      full(
        '<blockquote class="spoiler">\n'.repeat(500) +
          'x\n' +
          '</blockquote>\n'.repeat(500),
      ),
    ).not.toThrow();
  });
  it('parses legacy html spoiler blocks as Markdown', () => {
    const source =
      '<blockquote class="spoiler">\n\n```cpp\n#include <bits/stdc++.h>\nvector<long long> v;\n```\n\n</blockquote>\n\nafter';
    const expected =
      '<blockquote class="spoiler">\n<pre><code class="language-cpp">#include &lt;bits/stdc++.h&gt;\nvector&lt;long long&gt; v;\n</code></pre>\n</blockquote>\n<p>after</p>\n';
    expect(full(source)).toBe(expected);
    expect(renderMarkdown(source, 'problem')).toBe(expected);
    expect(renderMarkdown(source, 'solution')).toBe(expected);
    expect(full("  <blockquote  class='spoiler' >\nhi\n</blockquote>")).toBe(
      '<blockquote class="spoiler">\n<p>hi</p>\n</blockquote>\n',
    );
  });
  it('leaves an unclosed html spoiler to the plain HTML block, not the rest of the document', () => {
    expect(full('<blockquote class="spoiler">\nopen\n\nrest *here*')).toBe(
      '<blockquote class="spoiler">\nopen\n<p>rest <em>here</em></p>\n',
    );
  });
});
