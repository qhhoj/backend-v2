import { buildPdfHtml, formatKilobytes } from './pdf-template';

const input = {
  title: 'A <b>& B</b>',
  descriptionHtml:
    '<p>x</p><div class="h-scrollable-table"><table class="table"><tr><td>1</td></tr></table></div><img src="/media/images/a.png"><a href="//cdn.test/x">x</a>',
  timeLimit: 1.5,
  memoryLimit: 262144,
  languageLimits: [{ language: 'Python 3', timeLimit: 3, memoryLimit: 524288 }],
  materialUrl: 'https://qhhoj.test/media/materials/id/data.zip',
  katexCssUrl: 'file:///repo/node_modules/katex/dist/katex.min.css',
  mediaUrl: '/media',
  mediaRoot: '/var/lib/qhhoj/media',
  siteUrl: 'https://qhhoj.test',
};

describe('pdf template', () => {
  it.each([
    [262144, '256MB'],
    [1024, '1MB'],
    [512, '512KB'],
    [1048576, '1GB'],
    [1536, '2MB'],
  ])('formats %d KB as %s', (kilobytes, expected) =>
    expect(formatKilobytes(kilobytes)).toBe(expected),
  );
  it('escapes the title, unwraps tables, resolves media to the volume and protocol-relative urls to https', () => {
    const html = buildPdfHtml(input);
    expect(html).toContain('<h2>A &lt;b&gt;&amp; B&lt;/b&gt;</h2>');
    expect(html).toContain('<title>A &lt;b&gt;&amp; B&lt;/b&gt;</title>');
    expect(html).not.toContain('h-scrollable-table');
    expect(html).toContain('<table class="table"><tr><td>1</td></tr></table>');
    expect(html).toContain('src="file:///var/lib/qhhoj/media/images/a.png"');
    expect(html).toContain('href="https://cdn.test/x"');
    expect(html).toContain(
      '<link rel="stylesheet" href="file:///repo/node_modules/katex/dist/katex.min.css">',
    );
  });
  it.each([
    [
      'double quotes',
      '<img src="/media/a.png">',
      'src="file:///var/lib/qhhoj/media/a.png"',
    ],
    [
      'single quotes',
      "<img src='/media/a.png'>",
      "src='file:///var/lib/qhhoj/media/a.png'",
    ],
    [
      'no quotes',
      '<img src=/media/a.png>',
      'src=file:///var/lib/qhhoj/media/a.png',
    ],
    [
      'a stylesheet link',
      '<link rel="stylesheet" href="/media/a.css">',
      'href="file:///var/lib/qhhoj/media/a.css"',
    ],
    [
      'an anchor (kept a site link, never a file path)',
      '<a href="/media/m.zip">m</a>',
      'href="https://qhhoj.test/media/m.zip"',
    ],
  ])(
    'resolves media urls written with %s',
    (_label, descriptionHtml, expected) =>
      expect(buildPdfHtml({ ...input, descriptionHtml })).toContain(expected),
  );
  it('leaves lookalike prefixes alone', () =>
    expect(
      buildPdfHtml({
        ...input,
        descriptionHtml: '<img src="/mediafoo/a.png">',
      }),
    ).toContain('src="/mediafoo/a.png"'));
  it('lists limits, per-language limits and the materials link', () => {
    const html = buildPdfHtml(input);
    expect(html).toContain('<b>Time limit:</b> 1.5s');
    expect(html).toContain('<b>Memory limit:</b> 256MB');
    expect(html).toContain(
      '<span class="lang-name">Python 3</span> <span>3s</span>',
    );
    expect(html).toContain(
      '<span class="lang-name">Python 3</span> <span>512MB</span>',
    );
    expect(html).toContain(
      '<a href="https://qhhoj.test/media/materials/id/data.zip">Materials</a>',
    );
    expect(
      buildPdfHtml({ ...input, materialUrl: null, languageLimits: [] }),
    ).not.toContain('Materials');
  });
});
