import { renderMarkdown } from './markdown';

const links = { A: '/problems/sum_two', C: '/problems/max_three' };
const render = (text: string) =>
  renderMarkdown(text, 'problem', { problemLinks: links });

describe('#C problem references', () => {
  it('links a known label to its problem', () => {
    expect(render('Bài #C: n ≤ 2·10⁵')).toBe(
      '<p>Bài <a href="/problems/max_three">#C</a>: n ≤ 2·10⁵</p>\n',
    );
    expect(render('#A, #C.')).toContain(
      '<a href="/problems/sum_two">#A</a>, <a href="/problems/max_three">#C</a>.',
    );
  });

  it('leaves unknown labels, glued words, code and link text as written', () => {
    expect(render('x #B and #CD')).toBe('<p>x #B and #CD</p>\n');
    expect(render('abc#C')).toBe('<p>abc#C</p>\n');
    expect(render('`#C`')).toBe('<p><code>#C</code></p>\n');
    expect(render('[see #C](https://example.com)')).not.toContain(
      '/problems/max_three',
    );
  });

  it('keeps the legacy compact heading unless the line opens with a known reference', () => {
    expect(renderMarkdown('#C', 'problem')).toBe('<h3>C</h3>\n');
    expect(render('#Input')).toBe('<h3>Input</h3>\n');
    expect(render('#C')).toBe('<p><a href="/problems/max_three">#C</a></p>\n');
  });
});
