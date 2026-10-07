import { renderMarkdown } from './markdown';

const blog = (text: string) => renderMarkdown(text, 'blog');
const MATH_BATTERY = [
  '$\\frac{a+b}{c^2} + \\sqrt[3]{x_i}$',
  '$$\\sum_{i=1}^{n} \\binom{n}{i} \\int_0^\\infty e^{-x}\\,dx$$',
  '$\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix} \\xrightarrow{f} \\overbrace{x}^{y}$',
  '$\\hat{x} \\vec{v} \\overline{AB} \\underline{y} \\cancel{z} \\boxed{w} \\text{ hi } \\mathbb{R} \\left( \\frac{1}{2} \\right)$',
  '$$\\begin{CD} A @>a>> B \\\\ @VbVV @AAcA \\\\ C @= D \\end{CD}$$',
  '$\\rule[0.8em]{1em}{0.04em} \\colorbox{yellow}{y} \\underset{a}{b} \\sideset{_1^2}{_3^4}\\sum \\accentunder{x} \\utilde{y}$',
  '$$\\begin{array}{ccccccccc} 1&2&3&4&5&6&7&8&9 \\\\ \\frac{1}{2}&\\sqrt{3}&x^2&y_1&z&a&b&c&d \\\\ \\hline \\end{array}$$',
  '$\\begin{cases} 1 & x>0 \\\\ 0 & \\text{else} \\end{cases} \\not\\equiv \\stackrel{!}{=} \\overleftrightarrow{AB}$',
].join('\n\n');

describe('blog render style', () => {
  it('renders KaTeX exactly as the library emits it (nothing sanitized away)', () => {
    const library = renderMarkdown(MATH_BATTERY, 'problem-full');
    expect(library).toContain('katex');
    expect(blog(MATH_BATTERY)).toBe(library);
  });

  it('keeps code language classes, tables and spoilers', () => {
    expect(blog('```cpp\nint x;\n```')).toContain('class="language-cpp"');
    expect(blog('|a|b|\n|-|-|\n|1|2|')).toContain(
      '<div class="h-scrollable-table"><table class="table">',
    );
    expect(blog('>! secret')).toContain('class="spoiler"');
  });

  it('neutralizes every overlay primitive in author HTML', () => {
    const payloads = [
      '<div style="position:relative;top:-999em;left:-999em;width:100vw;height:100vh;background:#fff">x</div>',
      '<div style="margin-top:-100vh;margin-left:-100vw;width:300vw;height:300vh;background:#fff">x</div>',
      '<a href="https://evil.example" style="display:block;margin-top:-100vh;width:100vw;height:100vh;opacity:0">x</a>',
      '<div style="margin:-5000px;margin-bottom:calc(0px - 5000px);width:1dvh;height:1SVH">x</div>',
      '<div style="position:fixed;z-index:9999;inset:0;transform:scale(9);-webkit-transform:none;right:0;bottom:0">x</div>',
      '<div style="width:/**/100vw;height:100v/**/h">x</div>',
      '<div class="katex-display"><span class="katex"><span class="katex-html"><span class="katex-tag" style="top:-999em;width:100vw;height:100vh;background:#fff">x</span></span></span></div>',
      '<span class="katex" style="color:#fff"><svg style="top:-999em;height:100vh;width:100vw"><path d="M0 0h9999v9999z"/></svg></span>',
      '<span class="katex"><span class="cd-vert-arrow"><span class="cd-label-left" style="top:-999em;width:100vw;height:100vh;background:#fff">x</span></span></span>',
    ];
    for (const payload of payloads) {
      const html = blog(payload);
      expect(html).not.toMatch(
        /position|z-index|top:|left:|right:|bottom:|inset|transform|opacity|vh|vw|calc|-\d|\/\*|<svg|<path/i,
      );
      expect(html).not.toMatch(/class="([^"]* )?(katex|cd-|vlist)/);
    }
  });

  it('keeps ordinary styling', () => {
    expect(
      blog(
        '<div style="color:red;margin:4px 0 1em;width:50%;padding:2px">x</div>',
      ),
    ).toBe(
      '<div style="color:red;margin:4px 0 1em;width:50%;padding:2px">x</div>',
    );
  });

  it('keeps a forged math slot inert: only the render nonce addresses a formula', () => {
    const html = blog(
      'a $x^2$ b\n\n<span data-math="deadbeef-0"></span> and <span data-math="-0"></span> `<span data-math="x-0">`',
    );
    expect(html.match(/class="katex"/g)).toHaveLength(1);
    const formulas = (renderMarkdown('$x^2$', 'blog').match(/katex/g) ?? [])
      .length;
    expect(formulas).toBeGreaterThan(0);
    expect(html).toContain('data-math="deadbeef-0"');
    expect(html).not.toMatch(/data-math="[0-9a-f]{24}-/);
  });

  it('leaves no math slot behind in the output', () => {
    expect(renderMarkdown('$x$ and $$y$$ and ~z~', 'blog')).not.toContain(
      'data-math',
    );
  });

  it('sets rel on target links and limits iframe allow to fullscreen', () => {
    expect(blog('<a href="https://x.test" target="_blank">x</a>')).toContain(
      'rel="nofollow noopener noreferrer"',
    );
    const embed = blog(
      '<iframe src="https://www.youtube.com/embed/x" allow="camera; microphone"></iframe>',
    );
    expect(embed).not.toContain('allow=');
    expect(
      blog(
        '<iframe src="https://www.youtube.com/embed/x" allow="autoplay; fullscreen"></iframe>',
      ),
    ).toContain('allow="fullscreen"');
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
      '<p><span class="user-katex user-bad user-x">x</span></p>\n',
    );
    expect(blog('[user:alice]')).toContain('class="user-reference"');
  });

  it('is still sanitized like the editorial style', () => {
    expect(blog('<script>1</script><img src=x onerror=alert(1)>')).toBe(
      '<img src="x" />',
    );
  });
});
