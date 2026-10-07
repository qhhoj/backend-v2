import { renderMarkdown, renderMath } from './markdown';
import {
  createMathBudget,
  formulaRefusal,
  MAX_USER_MATH_MILLISECONDS,
} from './math';

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

  it.each(['title', 'xmp'])(
    'drops an inline <%s> instead of leaving an escaped slot',
    (tag) => {
      const html = blog(`a <${tag}>$x$</${tag}> b`);
      expect(html).toBe('<p>a  b</p>\n');
    },
  );

  it('drops author aria-hidden and span titles', () => {
    const html = blog(
      'a <span title="t" aria-hidden="true">y</span>\n\n<div aria-hidden="true">z</div>',
    );
    expect(html).toContain('<span>y</span>');
    expect(html).toContain('<div>z</div>');
    expect(html).not.toMatch(/aria-hidden|title/);
  });
});

describe('KaTeX in user-authored styles', () => {
  /** ~2 s of KaTeX work when not refused. */
  const AMPLIFIER = `$\\def\\a#1{${'#1'.repeat(20)}}\\a{\\a{${'x'.repeat(100)}}}$`;
  /** 48 expansions of an 850-letter `\\def`: no parameter, 43k parse-tree objects, seconds of KaTeX build. */
  const WIDE_DEF = `$\\def\\a{${'x'.repeat(850)}}${'\\a'.repeat(48)}$`;
  /** 25 expansions: just past the 20k-object cap, ~0.3 s of KaTeX build. */
  const OVER_CAP = `$\\def\\a{${'x'.repeat(850)}}${'\\a'.repeat(25)}$`;

  it.each(['blog', 'user'] as const)(
    'refuses parametered macros as text in the %s style',
    (style) => {
      for (const tex of [
        '$\\def\\a#1{#1}\\a{x}$',
        '$\\newcommand{\\f}[1]{#1}\\f{x}$',
        '$\\let\\d\\def \\d\\a#1{#1#1}$',
        '$\\def\\a#1{\\textcolor{#ff0000}{#1}}$',
        '$\\newcommand\\f[1]{\\textcolor{#1aa}{x}}\\f{1}$',
      ])
        expect(renderMarkdown(tex, style)).toContain('Macros with parameters');
      const html = renderMarkdown(AMPLIFIER, style);
      expect(html).toContain('Macros with parameters');
      expect(html).not.toContain('katex-html');
    },
    15_000,
  );

  it.each(['blog', 'user'] as const)(
    'keeps hex colours, plain macros, `\\#`, brackets and intervals working in the %s style',
    (style) => {
      for (const tex of [
        '$\\textcolor{#ff0000}{x}$',
        '$\\color{#fff} x$',
        '$\\colorbox{#eee}{y}$',
        '$\\fcolorbox{#000}{#ffffff80}{z}$',
        '$\\def\\x{y}\\x \\# 1$',
        '$\\def\\R{\\mathbb R}\\sqrt[3]{x} \\in [a,b]$',
        '$\\newcommand{\\f}{x}\\f[a,b]$',
      ]) {
        const html = renderMarkdown(tex, style);
        expect(html).toContain('katex-html');
        expect(html).not.toContain('math-error');
      }
    },
  );

  it('leaves staff styles alone', () => {
    expect(renderMarkdown('$\\def\\a#1{#1}\\a{x}$', 'solution')).toContain(
      'katex-html',
    );
  });

  it.each(['blog', 'user'] as const)(
    'refuses a parameter hidden in a hex-like group outside a colour command in the %s style',
    (style) => {
      const groups = '{#1aa}'.repeat(47);
      for (const tex of [
        `$\\let\\d\\newcommand\\d\\f[1]{${groups}}\\f{\\f{X}}$`,
        '$\\def\\n{\\newcommand}\\n\\f[1]{\\sqrt{#1aa}}\\f{y}$',
        '$\\def\\n{\\newcommand}\\n\\f[1]{{#1aa}}\\f{\\f{y}}$',
        '$\\let\\d\\newcommand\\d\\f[1]{\\textcolor{red}{#1aa}}\\f{y}$',
      ])
        expect(renderMarkdown(tex, style)).toContain('Macros with parameters');
    },
  );

  it.each(['blog', 'user'] as const)(
    'refuses formulas whose parse tree is too large in the %s style',
    (style) => {
      for (const tex of [WIDE_DEF, OVER_CAP]) {
        const html = renderMarkdown(tex, style);
        expect(html).toContain('Formula too large');
        expect(html).not.toContain('katex-html');
      }
      const cell = `\\begin{array}{${'c'.repeat(10)}}${'a&'.repeat(9)}a\\\\${'a&'.repeat(9)}a\\end{array}`;
      for (const tex of [
        `$$\\begin{array}{c}${Array(150).fill('a').join('\\\\')}\\end{array}$$`,
        `$\\def\\X{${cell}}${'\\X'.repeat(48)}$`,
        `$${'x^{y_{z}}'.repeat(110)}$`,
      ]) {
        const rendered = renderMarkdown(tex, style);
        expect(rendered).toContain('katex-html');
        expect(rendered).not.toContain('math-error');
      }
    },
  );

  it('keeps large formulas in staff styles', () => {
    expect(renderMarkdown(OVER_CAP, 'solution')).toContain('katex-html');
  });

  it('refuses a parse tree with too many objects without walking all of it', () => {
    let visited = 0;
    /** A million-object tree whose children are built only when read. */
    const lazyNode = (depth: number): object => ({
      get children() {
        visited++;
        return depth === 0
          ? []
          : Array.from({ length: 10 }, () => lazyNode(depth - 1));
      },
    });
    const tree = lazyNode(6);
    expect(formulaRefusal(tree)).toBe('Formula too large');
    expect(visited).toBeLessThan(25_000);
  });

  it('treats an unknown unit as beyond the size limit', () => {
    expect(formulaRefusal({ number: 1, unit: 'zz' })).toContain('Sizes beyond');
    expect(formulaRefusal({ number: 0, unit: 'zz' })).toContain('Sizes beyond');
    expect(formulaRefusal({ number: 1, unit: 'em' })).toBeUndefined();
  });

  it.each(['blog', 'user'] as const)(
    'refuses an \\arraystretch beyond 50 in the %s style',
    (style) => {
      expect(
        renderMarkdown(
          '$\\def\\arraystretch{51}\\begin{array}{c}a\\\\b\\end{array}$',
          style,
        ),
      ).toContain('Sizes beyond ±50em');
      for (const tex of [
        '$\\def\\arraystretch{2}\\begin{array}{c}a\\\\b\\end{array}$',
        '$\\begin{smallmatrix}a\\\\b\\end{smallmatrix}$',
      ])
        expect(renderMarkdown(tex, style)).toContain('katex-html');
    },
  );

  it('titles internal KaTeX failures generically', () => {
    expect(
      renderMarkdown('$\\newcommand\\f[1]{{#9ff}}\\f{x}$', 'solution'),
    ).toBe(
      '<p><span class="math-error" title="Invalid formula">$\\newcommand\\f[1]{{#9ff}}\\f{x}$</span></p>\n',
    );
  });

  it('renders a 200k-character field of worst-case formulas in bounded time', () => {
    const worst = [
      WIDE_DEF,
      `$\\def\\a{${'x'.repeat(800)}}${'\\a'.repeat(24)}$`,
      `$\\def\\a{${'\\sqrt{x}'.repeat(100)}}${'\\a'.repeat(48)}$`,
      `$\\let\\d\\newcommand\\d\\f[1]{${'{#1aa}'.repeat(47)}}\\f{\\f{X}}$`,
      AMPLIFIER,
    ];
    let field = '';
    for (let index = 0; field.length < 200_000; index++)
      field += `${worst[index % worst.length]}\n\n`;
    for (const style of ['blog', 'user'] as const) {
      const started = performance.now();
      const html = renderMarkdown(field, style);
      expect(performance.now() - started).toBeLessThan(2000);
      expect(html).toMatch(/Formula (time )?limit exceeded/);
    }
  });

  it.each(['blog', 'user'] as const)(
    'refuses dimensions beyond ±50em in the %s style, macros included',
    (style) => {
      for (const tex of [
        '$\\raisebox{-9999em}{x}$',
        '$\\kern{-9999em}$',
        '$\\rule[-9999em]{1em}{1em}$',
        '$\\rule{60em}{1em}$',
        '$\\def\\n{-51}\\kern\\n em$',
        '$\\hspace{-600pt}$',
        '$a \\\\[-51em] b$',
        '$\\mskip 901mu$',
        '$\\kern{117ex}$',
      ])
        expect(renderMarkdown(tex, style)).toContain('Sizes beyond ±50em');
      for (const tex of [
        '$\\raisebox{-50em}{x}$',
        '$\\kern{-400pt}$',
        '$\\rule{50em}{1em}$',
        '$\\mskip 900mu$',
        '$\\kern{116ex}$',
      ])
        expect(renderMarkdown(tex, style)).toContain('katex-html');
    },
  );

  it('keeps large and negative dimensions in staff styles', () => {
    expect(renderMarkdown('$\\raisebox{-9999em}{x}$', 'solution')).toContain(
      'vertical-align:-9999em',
    );
    expect(renderMarkdown('$\\kern{-9999em}$', 'solution')).toContain(
      '-9999em',
    );
    expect(renderMarkdown('$\\rule{60em}{1em}$', 'solution')).toContain(
      'width:60em',
    );
  });

  it('caps expansions at 50 for users', () => {
    const expansions = `$\\def\\a{${'\\b'.repeat(30)}}\\def\\b{${'\\c'.repeat(30)}}\\def\\c{x}\\a$`;
    expect(renderMarkdown(expansions, 'blog')).toContain('math-error');
    expect(renderMarkdown(expansions, 'solution')).toContain('katex-html');
  });

  it('reports the time budget once, then shows the remaining formulas as source', () => {
    let now = 0;
    const budget = createMathBudget(true, () => now);
    expect(renderMath('x', false, budget)).toContain('katex');
    now = MAX_USER_MATH_MILLISECONDS + 1;
    expect(renderMath('y', false, budget)).toBe(
      '<span class="math-error" title="Formula time limit exceeded">$y$</span>',
    );
    expect(budget.limitReported).toBe(true);
    expect(renderMath('z', false, budget)).toBe('$z$');
  });
});
