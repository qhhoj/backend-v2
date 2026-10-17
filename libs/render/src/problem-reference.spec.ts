import { renderMarkdown } from './markdown';

const known = { A: '/problems/sum_two', C: '/problems/max_three' };
/** The codes may be shown: only the contest's own labels are references. */
const linked = (text: string) =>
  renderMarkdown(text, 'problem', {
    problemLinks: { isLabel: (label) => label in known, hrefs: known },
  });
/** The codes are hidden: any label-shaped word becomes a label-only anchor. */
const labelOnly = (text: string) =>
  renderMarkdown(text, 'problem', {
    problemLinks: { isLabel: (label) => /^[A-Z]$/.test(label), hrefs: {} },
  });

describe('#C problem references', () => {
  it('links a known label to its problem', () => {
    expect(linked('Bài #C: n ≤ 2·10⁵')).toBe(
      '<p>Bài <a class="problem-ref" href="/problems/max_three">#C</a>: n ≤ 2·10⁵</p>\n',
    );
    expect(linked('#A, #C.')).toContain(
      '<a class="problem-ref" href="/problems/sum_two">#A</a>, <a class="problem-ref" href="/problems/max_three">#C</a>.',
    );
  });

  it('stores no code while the codes are hidden, only the label', () => {
    expect(labelOnly('Bài #C: n ≤ 2·10⁵')).toBe(
      '<p>Bài <a class="problem-ref">#C</a>: n ≤ 2·10⁵</p>\n',
    );
    expect(labelOnly('#B')).not.toContain('href');
  });

  it('leaves unknown labels, glued words, code and link text as written', () => {
    expect(linked('x #B and #CD')).toBe('<p>x #B and #CD</p>\n');
    expect(linked('abc#C')).toBe('<p>abc#C</p>\n');
    expect(linked('`#C`')).toBe('<p><code>#C</code></p>\n');
    expect(linked('[see #C](https://example.com)')).not.toContain(
      'problem-ref',
    );
  });

  it('keeps the legacy compact heading unless the line opens with a reference', () => {
    expect(renderMarkdown('#C', 'problem')).toBe('<h3>C</h3>\n');
    expect(linked('#Input')).toBe('<h3>Input</h3>\n');
    expect(linked('#C')).toBe(
      '<p><a class="problem-ref" href="/problems/max_three">#C</a></p>\n',
    );
    expect(labelOnly('#C')).toBe('<p><a class="problem-ref">#C</a></p>\n');
  });
});
