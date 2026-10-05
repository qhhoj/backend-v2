import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Apps run from the repo root (`node dist/apps/<app>/main`), so KaTeX's CSS and fonts are addressed from there; webpack rewrites `require.resolve`, hence no resolve. */
export const KATEX_DIST_DIR = join(
  process.cwd(),
  'node_modules',
  'katex',
  'dist',
);
/** Legacy pdfoid footer. */
export const PAGE_FOOTER =
  '<div style="width:100%;text-align:center;font-family:sans-serif;font-size:10px;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>';

export interface PdfTemplateInput {
  title: string;
  descriptionHtml: string;
  timeLimit: number;
  memoryLimit: number;
  languageLimits: Array<{
    language: string;
    timeLimit: number;
    memoryLimit: number;
  }>;
  materialUrl: string | null;
  katexCssUrl: string;
  mediaUrl: string;
  mediaRoot: string;
}

const UNITS = ['KB', 'MB', 'GB', 'TB'];
/** Legacy `kbsimpleformat`: whole numbers, largest unit below 1024. */
export function formatKilobytes(kilobytes: number): string {
  let value = kilobytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${Math.round(value)}${UNITS[unit]}`;
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);
/** Legacy `clean_markdown_table`: the scrollable wrapper is for screens. */
const unwrapTables = (html: string) =>
  html
    .replaceAll(
      '<div class="h-scrollable-table"><table class="table">',
      '<table class="table">',
    )
    .replaceAll('</table></div>', '</table>');
const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Media is read straight from the shared volume (no network from a PDF render), in double-quoted, single-quoted and unquoted `src`/`href`; `//host` links become https like legacy. */
const absolutify = (html: string, mediaUrl: string, mediaRoot: string) =>
  html
    .replace(
      new RegExp(
        `(\\b(?:src|href)\\s*=\\s*["']?)${escapeRegExp(mediaUrl)}/`,
        'gi',
      ),
      (_match, attribute: string) =>
        `${attribute}${pathToFileURL(mediaRoot).href}/`,
    )
    .replaceAll('="//', '="https://')
    .replaceAll("='//", "='https://");

const limitRows = (
  limits: PdfTemplateInput['languageLimits'],
  render: (limit: PdfTemplateInput['languageLimits'][number]) => string,
) =>
  limits
    .map(
      (limit) =>
        `<div class="lang-limit"><span class="lang-name">${escapeHtml(limit.language)}</span> <span>${render(limit)}</span></div>`,
    )
    .join('');

const STYLE = `
html, body { background: white; }
body { font-family: 'Segoe UI', 'Noto Sans', 'DejaVu Sans', sans-serif; font-size: 11pt; margin: 0; }
tr { page-break-inside: avoid; }
.limits { text-align: center; }
.problem-info-entry { display: inline-block; vertical-align: top; padding: 0.6em; text-align: left; }
.lang-limit { margin-left: 1.5em; }
.lang-name:after { content: ': '; }
.content-description { line-height: 1.5; }
.content-description pre { background: #f6f6f6; border: 1px solid #ddd; padding: 0.5em; white-space: pre-wrap; }
.content-description table.table { border-collapse: collapse; }
.content-description table.table td, .content-description table.table th { border: 1px solid #999; padding: 0.3em 0.6em; }
.content-description img { max-width: 100%; }
.math-error { color: #b00; }
`;

/** Port of legacy `templates/problem/raw.html` with KaTeX's CSS instead of MathJax (the stored HTML already contains the rendered math). */
export function buildPdfHtml(input: PdfTemplateInput): string {
  const title = escapeHtml(input.title);
  const materials = input.materialUrl
    ? `<div class="content-description printing"><h4>Problem Materials</h4><p>Download materials for this problem: <a href="${escapeHtml(input.materialUrl)}">Materials</a></p></div>`
    : '';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title>
<link rel="stylesheet" href="${escapeHtml(input.katexCssUrl)}">
<style>${STYLE}</style></head>
<body>
<h2>${title}</h2>
<hr>
<div class="limits">
<div class="problem-info-entry"><b>Time limit:</b> ${input.timeLimit}s${limitRows(input.languageLimits, (limit) => `${limit.timeLimit}s`)}</div>
<div class="problem-info-entry"><b>Memory limit:</b> ${formatKilobytes(input.memoryLimit)}${limitRows(input.languageLimits, (limit) => formatKilobytes(limit.memoryLimit))}</div>
</div>
<hr>
<div class="content-description printing">${absolutify(unwrapTables(input.descriptionHtml), input.mediaUrl, input.mediaRoot)}</div>
${materials}
</body></html>`;
}
