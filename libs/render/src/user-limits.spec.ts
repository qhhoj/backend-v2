import { renderMarkdown, RenderLimitError } from './index';
import { sanitizeEach } from './markdown';
import { renderMath } from './math';
import { sanitizeStatementHtml } from './sanitizer';

const fill = (unit: string, length: number) =>
  unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
const count = (html: string, part: string) => html.split(part).length - 1;
const table = (columns: number, rows: number) =>
  `${'|h'.repeat(columns)}|\n${'|-'.repeat(columns)}|\n${Array.from(
    { length: rows },
    (_cell, row) => `${'|x'.repeat(columns).replace(/x/g, String(row))}|`,
  ).join('\n')}\n`;

describe('user-style table cells', () => {
  it('refuses a table over the cell limit before laying out its cells', () => {
    const padded = `${fill('|a', 2048)}|\n${fill('|-', 2048)}|\n${fill('|\n', 4092)}`;
    expect(() => renderMarkdown(padded, 'user')).toThrow(
      new RenderLimitError('Tables have too many cells'),
    );
    const inQuote = `> ${fill('|a', 400)}|\n> ${fill('|-', 400)}|\n${'> |\n'.repeat(1000)}`;
    expect(() => renderMarkdown(inQuote, 'user')).toThrow(RenderLimitError);
  });

  it('counts cells over every table of the render', () => {
    const paddedTable = `${'|a'.repeat(30)}|\n${'|-'.repeat(30)}|\n${'|\n'.repeat(20)}`;
    const many = `${paddedTable}\n`.repeat(12);
    expect(() => renderMarkdown(many, 'user')).toThrow(
      new RenderLimitError('Tables have too many cells'),
    );
    expect(() => renderMarkdown(paddedTable, 'user')).not.toThrow();
  });

  it('lays out written tables whole, short rows padded as before', () => {
    const html = renderMarkdown(table(30, 30), 'user');
    expect(count(html, '<td>')).toBe(900);
    expect(count(html, '<th>')).toBe(30);
    const short = renderMarkdown('|a|b|c|\n|-|-|-|\n|1|\n|2|3|\n', 'user');
    expect(count(short, '<td>')).toBe(6);
    expect(count(short, '<td></td>')).toBe(3);
  });

  it('leaves the other styles alone', () => {
    const padded = `${'|a'.repeat(100)}|\n${'|-'.repeat(100)}|\n${'|\n'.repeat(100)}`;
    expect(() => renderMarkdown(padded, 'user')).toThrow(RenderLimitError);
    expect(count(renderMarkdown(padded, 'blog'), '<td></td>')).toBe(100 * 100);
  });
});

describe('user-style formula parse work', () => {
  const bigDef = `$\\def\\a{${'x'.repeat(900)}}${'\\a'.repeat(40)}$ `;

  it('stops at the first formula that spends the work and shows the rest as source', () => {
    const html = renderMarkdown(fill(bigDef, 8192), 'user');
    expect(count(html, 'class="math-error"')).toBe(1);
    expect(html).toContain('title="Formula limit exceeded"');
    expect(html).not.toContain('class="katex"');
    expect(count(html, '\\def\\a{')).toBe(9);
  });

  it('charges the tokens macros expand to, also when they draw nothing', () => {
    const relax = `$\\def\\a{${'\\relax'.repeat(140)}}${'\\a'.repeat(48)} x$`;
    const three = `${relax}\n\n${relax}\n\n${relax}`;
    const html = renderMarkdown(three, 'user');
    expect(count(html, 'class="katex"')).toBe(1);
    expect(html).toContain('title="Formula limit exceeded"');
    expect(count(renderMarkdown(three, 'blog'), 'class="katex"')).toBe(3);
  });

  it('renders ordinary formulas and small macros as before', () => {
    const text =
      '$\\def\\R{\\mathbb{R}} f: \\R \\to \\R$ and $\\sum_{i=1}^{n} a_i \\le 10^9$ and $$\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}$$';
    const html = renderMarkdown(text, 'user');
    expect(count(html, 'class="katex"')).toBe(3);
    expect(html).not.toContain('math-error');
  });
});

describe('sanitizeEach', () => {
  it('gives the same pieces as sanitizing each formula on its own', () => {
    const formulas = [
      renderMath('\\frac{a}{b}', false),
      renderMath('\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}', true),
      renderMath('\\sqrt{x} + \\overbrace{y}', false),
      renderMath('\\bad', false),
      `$a<b & 'c'$`,
      '<span class="math-error" title="x">$\\x$</span>',
      '',
    ];
    expect(sanitizeEach(formulas, 'n0nce')).toEqual(
      formulas.map(sanitizeStatementHtml),
    );
  });
});
