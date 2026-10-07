import { renderMarkdown } from './markdown';

const blog = (text: string) => renderMarkdown(text, 'blog');
const MATH_BATTERY = [
  '$\\frac{a+b}{c^2} + \\sqrt[3]{x_i}$',
  '$$\\sum_{i=1}^{n} \\binom{n}{i} \\int_0^\\infty e^{-x}\\,dx$$',
  '$\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix} \\xrightarrow{f} \\overbrace{x}^{y}$',
  '$\\hat{x} \\vec{v} \\overline{AB} \\underline{y} \\cancel{z} \\boxed{w} \\text{ hi } \\mathbb{R} \\left( \\frac{1}{2} \\right)$',
  '$\\begin{cases} 1 & x>0 \\\\ 0 & \\text{else} \\end{cases} \\not\\equiv \\stackrel{!}{=} \\overleftrightarrow{AB}$',
].join('\n\n');

describe('blog render style', () => {
  it('renders KaTeX exactly as the editorial style does', () => {
    const editorial = renderMarkdown(MATH_BATTERY, 'solution');
    expect(editorial).toContain('katex');
    expect(blog(MATH_BATTERY)).toBe(editorial);
  });

  it('keeps code language classes, tables and spoilers', () => {
    expect(blog('```cpp\nint x;\n```')).toContain('class="language-cpp"');
    expect(blog('|a|b|\n|-|-|\n|1|2|')).toContain(
      '<div class="h-scrollable-table"><table class="table">',
    );
    expect(blog('>! secret')).toContain('class="spoiler"');
  });

  it('drops layout-escaping CSS but keeps ordinary styling', () => {
    expect(
      blog(
        '<div style="position:fixed;z-index:9999;top:0;left:0;right:0;bottom:0;inset:0;transform:scale(9);-webkit-transform:none;color:red;margin:4px">x</div>',
      ),
    ).toBe('<div style="color:red;margin:4px">x</div>');
    expect(blog('<div style="position:absolute;color:red">x</div>')).toBe(
      '<div style="color:red">x</div>',
    );
    expect(blog('<div style="position:relative">x</div>')).toBe(
      '<div style="position:relative">x</div>',
    );
    expect(blog('<div style="top:-3.5em;left:2em">x</div>')).toContain(
      'top:-3.5em;left:2em',
    );
    expect(blog('<div style="top:100%;left:-9999px">x</div>')).toBe(
      '<div>x</div>',
    );
  });

  it('keeps only embeds from the allow-list, sandboxed and lazy', () => {
    const sandbox =
      'sandbox="allow-scripts allow-same-origin allow-presentation" loading="lazy"';
    const allowed = [
      'https://www.youtube.com/embed/abc_DEF-1',
      'https://www.youtube-nocookie.com/embed/abc',
      'https://player.vimeo.com/video/123',
    ];
    for (const src of allowed)
      expect(blog(`<iframe src="${src}"></iframe>`)).toContain(
        `<iframe src="${src}" ${sandbox}>`,
      );
    expect(
      blog(
        '<iframe src="https://www.youtube.com/embed/x" sandbox="" loading="eager"></iframe>',
      ),
    ).toContain(sandbox);
    for (const src of [
      'https://evil.example/',
      'https://www.youtube.com.evil.example/embed/x',
      'https://evil.example/https://www.youtube.com/embed/x',
      'http://www.youtube.com/embed/x',
      'https://www.youtube.com/watch?v=x',
      'javascript:alert(1)',
    ])
      expect(blog(`<p>a</p><iframe src="${src}"></iframe>`)).toBe('<p>a</p>');
    expect(blog('<iframe></iframe>')).toBe('');
  });

  it('drops ids and prefixes author classes, keeping pipeline classes', () => {
    expect(blog('<div id="navbar" class="navbar sticky">x</div>')).toBe(
      '<div class="user-navbar user-sticky">x</div>',
    );
    expect(blog('<p id="__proto__">x</p>')).toBe('<p>x</p>');
    expect(blog('<span class="katex bad user-x">x</span>')).toBe(
      '<p><span class="katex user-bad user-x">x</span></p>\n',
    );
    expect(blog('[user:alice]')).toContain('class="user-reference"');
  });

  it('is still sanitized like the editorial style', () => {
    expect(blog('<script>1</script><img src=x onerror=alert(1)>')).toBe(
      '<img src="x" />',
    );
  });
});
