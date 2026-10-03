import katex from 'katex';
import { LEGACY_STYLE_PROPERTIES, MATHML_TAGS } from './legacy-allow-list';
import { sanitizeStatementHtml, sanitizeSvg } from './sanitizer';

const MATHML_N =
  '<math xmlns="http://www.w3.org/1998/Math/MathML">\n<semantics>\n<mi>N</mi>\n<annotation encoding="application/x-tex">N</annotation>\n</semantics>\n</math>\n';
/** sanitize-html drops the trailing `;` of style values and expands `<path .../>`; nothing else may change. */
const serialised = (html: string) =>
  html
    .replace(/;"/g, '"')
    .replace(/<path d="([^"]*)"\/>/g, '<path d="$1"></path>');

describe('sanitizeStatementHtml', () => {
  it('ships the generated legacy allow-list', () => {
    expect(LEGACY_STYLE_PROPERTIES).toHaveLength(577);
    expect(MATHML_TAGS).toHaveLength(202);
  });
  it.each([
    ['<script>alert(1)</script><p>ok</p>', '<p>ok</p>'],
    ['<img src="x" onerror="alert(1)">', '<img src="x" />'],
    ['<a href="javascript:alert(1)">x</a>', '<a>x</a>'],
    [
      '<a href="https://ok.test" rel="nofollow noopener" target="_blank">y</a>',
      '<a href="https://ok.test" rel="nofollow noopener" target="_blank">y</a>',
    ],
    [
      '<div style="color:red;width:expression(alert(1));background:url(javascript:1)">s</div>',
      '<div style="color:red">s</div>',
    ],
    [
      '<svg onload="alert(1)"><script>1</script><path d="M0 0" onclick="x"/></svg>',
      '<svg><path d="M0 0"></path></svg>',
    ],
    [
      '<math><maction actiontype="statusline#http://x" xlink:href="javascript:alert(1)"><mi>x</mi></maction></math>',
      '<math><maction actiontype="statusline#http://x"><mi>x</mi></maction></math>',
    ],
    ['<iframe src="javascript:alert(1)"></iframe>', '<iframe></iframe>'],
    [
      '<iframe src="https://www.youtube.com/embed/x" allow="fullscreen"></iframe>',
      '<iframe src="https://www.youtube.com/embed/x" allow="fullscreen"></iframe>',
    ],
    [
      '<object data="javascript:alert(1)"></object><style>body{display:none}</style>',
      '',
    ],
    ['<img src="data:image/png;base64,AAAA">', '<img />'],
    [
      '<video poster="javascript:1" src="https://ok.test/v.mp4" controls></video>',
      '<video src="https://ok.test/v.mp4" controls></video>',
    ],
    [
      '<p style="display: block; margin: 0 auto">p</p>',
      '<p style="display:block;margin:0 auto">p</p>',
    ],
    [
      '<table><tr><td colspan="2">x</td></tr></table>',
      '<table><tr><td colspan="2">x</td></tr></table>',
    ],
    ['<p>a<br>b</p><hr>', '<p>a<br />b</p><hr />'],
    ['<p style="background:red&#10;url(https://evil/x.png)">p</p>', '<p>p</p>'],
    ['<p style="background:red&#13;url(https://evil/x.png)">p</p>', '<p>p</p>'],
    ['<p style="width:red&#10;expression(alert(1))">p</p>', '<p>p</p>'],
    [
      '<p style="background:image-set(\'https://evil/x.png\' 1x)">p</p>',
      '<p>p</p>',
    ],
    [
      '<p style="background:-webkit-image-set(\'https://evil/x.png\' 1x)">p</p>',
      '<p>p</p>',
    ],
    ['<a href="jav&#x09;ascript:alert(1)">x</a>', '<a>x</a>'],
    [
      '<source srcset="a.png 1x, javascript:alert(1) 2x">',
      '<source srcset="a.png 1x"></source>',
    ],
    [
      '<math altimg="javascript:x"><mi>x</mi></math>',
      '<math><mi>x</mi></math>',
    ],
    ['<img data-src="javascript:x">', '<img />'],
    [
      '<span style="height:1.08em;margin-right:-0.25em;top:-0.5em">k</span>',
      '<span style="height:1.08em;margin-right:-0.25em;top:-0.5em">k</span>',
    ],
  ])('cleans %s', (input, expected) =>
    expect(sanitizeStatementHtml(input)).toBe(expected),
  );
  it('keeps the legacy MathML sample unchanged', () =>
    expect(sanitizeStatementHtml(MATHML_N)).toBe(MATHML_N));
  it.each([
    '\\sqrt{x^2+1}',
    '\\overbrace{a+b}^{n}',
    '\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}',
    '\\text{số } n \\le 10^5',
  ])('keeps KaTeX output for %s apart from serialisation', (tex) => {
    for (const displayMode of [false, true]) {
      const html = katex.renderToString(tex, {
        displayMode,
        trust: false,
        strict: 'ignore',
      });
      expect(sanitizeStatementHtml(html)).toBe(serialised(html));
    }
  });
});

describe('sanitizeSvg', () => {
  it('keeps shapes, gradients and local references and drops scripts, handlers, styles, foreign content and external hrefs', () => {
    const svg =
      '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10" onload="alert(1)"><script>alert(2)</script><defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient></defs><a xlink:href="javascript:alert(3)"><rect width="5" height="5" fill="url(#g)" style="x:expression(1)"/></a><use href="#g"/><use xlink:href="javascript:alert(4)"/><use xlink:href="http://evil/x.svg#y"/><foreignObject><body/></foreignObject><text x="1" y="2">Hi</text></svg>';
    expect(sanitizeSvg(svg)).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stop-color="red"></stop></linearGradient></defs><rect width="5" height="5" fill="url(#g)"></rect><use href="#g"></use><use></use><use></use><text x="1" y="2">Hi</text></svg>',
    );
  });
  it('keeps colors and local paint references and drops external ones', () => {
    expect(
      sanitizeSvg(
        '<rect fill="url(https://evil/g.svg#x)" clip-path="url(https://evil/c.svg#c)" mask="url(//evil/m.svg#m)"/>',
      ),
    ).toBe('<rect></rect>');
    for (const fill of [
      'u\\72l(https://evil/g.svg#x)',
      '\\75rl(https://evil/g.svg#x)',
      'ur\\6c (https://evil/g.svg#x)',
    ]) {
      expect(sanitizeSvg(`<svg><rect fill="${fill}"/></svg>`)).toBe(
        '<svg><rect></rect></svg>',
      );
    }
    expect(sanitizeSvg('<rect fill="url(#grad)" stroke="red"/>')).toBe(
      '<rect fill="url(#grad)" stroke="red"></rect>',
    );
  });
});
