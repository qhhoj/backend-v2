import { renderMarkdown, renderMath } from './markdown';
import { createMathBudget, MAX_USER_MATH_MILLISECONDS } from './math';

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
      '<div style="-webkit-margin-before:-5000px;margin-block-start:-5000px;padding:-9px;-moz-margin-start:-4000px;height:5000px;background:#fff">Log in</div>',
      '<div style="width:100dvi;height:100dvb;min-width:100cqw;min-height:100svb;max-width:100lvi;width:calc(100% + 9999px)">x</div>',
      '<math><mpadded voffset="9999px" height="0" width="0"><mtext mathbackground="#fff">Log in</mtext></mpadded></math><math><mspace width="9999px" height="9999px"></mspace></math>',
      '<div style="flex-basis:100dvi;line-height:100cqw">x</div>',
      '<div style="background:image(\'https://evil.example/x\')">x</div>',
      '<span class="katex" style="color:#fff"><svg style="top:-999em;height:100vh;width:100vw"><path d="M0 0h9999v9999z"/></svg></span>',
      '<span class="katex"><span class="cd-vert-arrow"><span class="cd-label-left" style="top:-999em;width:100vw;height:100vh;background:#fff">x</span></span></span>',
    ];
    for (const payload of payloads) {
      const html = blog(payload);
      expect(html).not.toMatch(
        /position|z-index|top:|left:|right:|bottom:|inset|transform|opacity|vh|vw|calc|image|mpadded|mspace|<math|-\d|\/\*|<svg|<path|dvi|cqw/i,
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
      '<p><span class="user-katex user-bad user-user-x">x</span></p>\n',
    );
    expect(blog('[user:alice]')).toContain('class="user-reference"');
    expect(blog('<a class="user-admin" href="https://x.test">x</a>')).toContain(
      'class="user-user-admin"',
    );
  });

  it('is still sanitized like the editorial style', () => {
    expect(blog('<script>1</script><img src=x onerror=alert(1)>')).toBe(
      '<img src="x" />',
    );
  });

  it('answers adversarial style values in bounded time and caps their size', () => {
    const digits = '1'.repeat(200_000);
    const started = performance.now();
    for (const property of ['margin', 'padding', 'width', 'color'])
      blog(`<div style="${property}:${digits}x">x</div>`);
    blog(`<div style="margin:${'1 '.repeat(100_000)}x">x</div>`);
    expect(performance.now() - started).toBeLessThan(500);
    expect(blog(`<div style="margin:${'1'.repeat(300)}px">x</div>`)).toBe(
      '<div>x</div>',
    );
    expect(
      blog(`<div style="color:red;margin:${'1'.repeat(3000)}px">x</div>`),
    ).not.toContain('margin');
    const declarations = Array.from({ length: 200 }, () => 'color:red').join(
      ';',
    );
    expect(
      (blog(`<div style="${declarations}">x</div>`).match(/color/g) ?? [])
        .length,
    ).toBeLessThan(200);
  });

  it('allows only listed length units and sizing keywords', () => {
    expect(
      blog(
        '<div style="width:50%;height:auto;min-width:fit-content;max-height:12px">x</div>',
      ),
    ).toBe(
      '<div style="width:50%;height:auto;min-width:fit-content;max-height:12px">x</div>',
    );
    expect(blog('<div style="width:10cm;height:5in;margin:3mm">x</div>')).toBe(
      '<div>x</div>',
    );
  });

  it('drops RCDATA titles instead of leaving escaped slots', () => {
    expect(blog('<title>$x$</title>y')).not.toContain('data-math');
  });
});

describe('KaTeX in user-authored styles', () => {
  const AMPLIFIER = `$\\def\\a#1{${'#1'.repeat(100)}}\\a{\\a{${'x'.repeat(500)}}}$`;

  it.each(['blog', 'user'] as const)(
    'refuses parametered macros as text in the %s style, fast',
    (style) => {
      const started = performance.now();
      const html = renderMarkdown(AMPLIFIER, style);
      expect(performance.now() - started).toBeLessThan(500);
      expect(html).toContain('math-error');
      expect(html).not.toContain('katex-html');
      expect(html).toContain('Macros with parameters');
      expect(
        renderMarkdown('$\\newcommand{\\f}[1]{#1}\\f{x}$', style),
      ).toContain('math-error');
      expect(renderMarkdown('$\\let\\d\\def \\d\\a#1{#1#1}$', style)).toContain(
        'math-error',
      );
    },
  );

  it('keeps plain macros and `\\#` working, and leaves staff styles alone', () => {
    expect(renderMarkdown('$\\def\\x{y}\\x \\# 1$', 'blog')).toContain(
      'katex-html',
    );
    expect(renderMarkdown('$\\def\\a#1{#1}\\a{x}$', 'solution')).toContain(
      'katex-html',
    );
  });

  it('caps sizes at 50em and expansions at 50 for users, not staff', () => {
    const rule = '$\\rule{60em}{1em}$';
    expect(renderMarkdown(rule, 'blog')).toContain('width:50em');
    expect(renderMarkdown(rule, 'blog')).not.toContain('width:60em');
    expect(renderMarkdown(rule, 'solution')).toContain('width:60em');
    const expansions = `$\\def\\a{${'\\b'.repeat(30)}}\\def\\b{${'\\c'.repeat(30)}}\\def\\c{x}\\a$`;
    expect(renderMarkdown(expansions, 'blog')).toContain('math-error');
  });

  it('shows the remaining formulas as source once the time budget is spent', () => {
    let now = 0;
    const budget = createMathBudget(true, () => now);
    expect(renderMath('x', false, budget)).toContain('katex');
    now = MAX_USER_MATH_MILLISECONDS + 1;
    expect(renderMath('y', false, budget)).toBe('$y$');
  });
});
