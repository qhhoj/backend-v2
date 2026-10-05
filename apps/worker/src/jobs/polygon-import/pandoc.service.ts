import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PolygonImportError } from './polygon-import.error';

const FILTER_FILE = 'filter.lua';
const VERSION_TIMEOUT_MS = 10_000;
const MINIMUM_MAJOR_VERSION = 3;

/** Polygon's \bf, \it, \tt and \t are modern commands here (legacy TEX_MACROS). */
export const TEX_MACROS = `
\\renewcommand{\\bf}{\\textbf}
\\renewcommand{\\it}{\\textit}
\\renewcommand{\\tt}{\\texttt}
\\renewcommand{\\t}{\\texttt}
`;

/** Legacy PANDOC_FILTER, verbatim (quote normalisation, math delimiters, Codeforces-like code spans, dashes, center/epigraph divs). */
export const PANDOC_FILTER = String.raw`
local function normalize_quote(text)
    -- These four quotes are disallowed characters.
    -- See DMOJ_PROBLEM_STATEMENT_DISALLOWED_CHARACTERS
    text = text:gsub('\u{2018}', "'") -- left single quote
    text = text:gsub('\u{2019}', "'") -- right single quote
    text = text:gsub('\u{201C}', '"') -- left double quote
    text = text:gsub('\u{201D}', '"') -- right double quote
    return text
end

local function escape_html_content(text)
    -- Escape HTML/Markdown/MathJax syntax characters
    text = text:gsub('&', '&amp;') -- must be first
    text = text:gsub('<', "&lt;")
    text = text:gsub('>', "&gt;")
    text = text:gsub('*', '\\*')
    text = text:gsub('_', '\\_')
    text = text:gsub('%$', '<span>%$</span>')
    text = text:gsub('~', '<span>~</span>')
    return text
end

function Math(m)
    -- Fix math delimiters
    local delimiter = m.mathtype == 'InlineMath' and '$' or '$$'
    return pandoc.RawInline('html', delimiter .. m.text .. delimiter)
end

function Image(el)
    -- And blank lines before and after the image for caption to work
    return {pandoc.RawInline('markdown', '\n\n'), el, pandoc.RawInline('markdown', '\n\n')}
end

function Code(el)
    -- Normalize quotes and render similar to Codeforces
    local text = normalize_quote(el.text)
    text = escape_html_content(text)
    return pandoc.RawInline('html', '<span style="font-family: courier new,monospace;">' .. text .. '</span>')
end

function CodeBlock(el)
    -- Normalize quotes
    el.text = normalize_quote(el.text)

    -- Set language to empty string if it's nil
    -- This is a hack to force backtick code blocks instead of indented code blocks
    -- See https://github.com/jgm/pandoc/issues/7033
    if el.classes[1] == nil then
        el.classes[1] = ''
    end

    return el
end

function Quoted(el)
    -- Normalize quotes
    local quote = el.quotetype == 'SingleQuote' and "'" or '"'
    local inlines = el.content
    table.insert(inlines, 1, quote)
    table.insert(inlines, quote)
    return inlines
end

function Str(el)
    -- Normalize quotes
    el.text = normalize_quote(el.text)

    -- en dash/em dash/non-breaking space would still show up correctly if we don't escape them,
    -- but they would be hardly noticeable while editing.
    local res = {}
    local part = ''
    for c in el.text:gmatch(utf8.charpattern) do
        if c == '\u{2013}' then
            -- en dash
            if part ~= '' then
                table.insert(res, pandoc.Str(part))
                part = ''
            end
            table.insert(res, pandoc.RawInline('html', '&ndash;'))
        elseif c == '\u{2014}' then
            -- em dash
            if part ~= '' then
                table.insert(res, pandoc.Str(part))
                part = ''
            end
            table.insert(res, pandoc.RawInline('html', '&mdash;'))
        elseif c == '\u{00A0}' then
            -- Non-breaking space
            if part ~= '' then
                table.insert(res, pandoc.Str(part))
                part = ''
            end
            table.insert(res, pandoc.RawInline('html', '&nbsp;'))
        else
            part = part .. c
        end
    end
    if part ~= '' then
        table.insert(res, pandoc.Str(part))
    end

    return res
end

function Div(el)
    if el.classes[1] == 'center' then
        local res = {}
        table.insert(res, pandoc.RawBlock('markdown', '<' .. el.classes[1] .. '>'))
        for _, block in ipairs(el.content) do
            table.insert(res, block)
        end
        table.insert(res, pandoc.RawBlock('markdown', '</' .. el.classes[1] .. '>'))
        return res

    elseif el.classes[1] == 'epigraph' then
        local filter = {
            Math = Math,
            Code = Code,
            Quoted = Quoted,
            Str = Str,
            Para = function (s)
                return pandoc.Plain(s.content)
            end,
            Span = function (s)
                return s.content
            end
        }

        function renderHTML(el)
            local doc = pandoc.Pandoc({el})
            local rendered = pandoc.write(doc:walk(filter), 'html')
            return pandoc.RawBlock('markdown', rendered)
        end

        local res = {}
        table.insert(res, pandoc.RawBlock('markdown', '<div style="margin-left: 67%;">'))
        if el.content[1] then
            table.insert(res, renderHTML(el.content[1]))
        end
        table.insert(res, pandoc.RawBlock('markdown', '<div style="border-top: 1px solid #888;"></div>'))
        if el.content[2] then
            table.insert(res, renderHTML(el.content[2]))
        end
        table.insert(res, pandoc.RawBlock('markdown', '</div>'))
        return res
    end

    return nil
end
`;

/** The statement is attacker-controlled TeX: `--sandbox` (pandoc >= 2.15) forbids \input, \include, \includegraphics and \verbatiminput from reading local files. */
export const PANDOC_ARGUMENTS = [
  '--sandbox',
  '-f',
  'latex',
  '-t',
  'gfm',
] as const;

interface ProcessLimits {
  timeoutMs: number;
  maxInputBytes: number;
  maxOutputBytes: number;
}

/** pandoc >= 3 in the worker image; TeX → GitHub-flavoured Markdown through the legacy Lua filter. The TeX goes in on stdin and never in argv; the process is killed on timeout and on output overflow. */
@Injectable()
export class PandocService {
  protected readonly binary: string = 'pandoc';
  protected readonly limits: ProcessLimits = {
    timeoutMs: 60_000,
    maxInputBytes: 1024 * 1024,
    maxOutputBytes: 8 * 1024 * 1024,
  };

  async texToMarkdown(tex: string): Promise<string> {
    const input = Buffer.from(TEX_MACROS + tex, 'utf8');
    if (input.length > this.limits.maxInputBytes)
      throw new PolygonImportError('statement TeX is too large');
    const directory = await mkdtemp(join(tmpdir(), 'qhhoj-pandoc-'));
    try {
      await writeFile(join(directory, FILTER_FILE), PANDOC_FILTER, 'utf8');
      return await this.run(
        [...PANDOC_ARGUMENTS, `--lua-filter=${FILTER_FILE}`],
        input,
        directory,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  async version(): Promise<number[] | null> {
    try {
      const banner = await this.run(
        ['--version'],
        Buffer.alloc(0),
        tmpdir(),
        VERSION_TIMEOUT_MS,
      );
      return banner.split('\n')[0].split(' ')[1].split('.').map(Number);
    } catch {
      return null;
    }
  }

  async assertAvailable(): Promise<void> {
    const version = await this.version();
    if (!version) throw new PolygonImportError('pandoc not installed');
    if (version[0] < MINIMUM_MAJOR_VERSION)
      throw new PolygonImportError('pandoc version must be at least 3.0.0');
  }

  private run(
    args: readonly string[],
    input: Buffer,
    cwd: string,
    timeoutMs = this.limits.timeoutMs,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.binary, args, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true,
        env: { PATH: process.env.PATH ?? '' },
      });
      const chunks: Buffer[] = [];
      let outputBytes = 0;
      let errorText = '';
      let failure: PolygonImportError | null = null;
      /** pandoc's own children share its process group; killing the group frees the pipes. */
      const killGroup = () => {
        try {
          process.kill(-child.pid!, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
      };
      const abort = (reason: string) => {
        failure ??= new PolygonImportError(reason);
        killGroup();
      };
      const timer = setTimeout(() => abort('pandoc timed out'), timeoutMs);
      child.stdout.on('data', (chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputBytes > this.limits.maxOutputBytes)
          return abort('pandoc output is too large');
        chunks.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        errorText = (errorText + chunk.toString('utf8')).slice(0, 500);
      });
      child.stdin.on('error', () => undefined);
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(new PolygonImportError(`pandoc failed: ${error.message}`));
      });
      child.once('close', (code) => {
        clearTimeout(timer);
        if (failure) return reject(failure);
        if (code !== 0)
          return reject(
            new PolygonImportError(`pandoc failed: ${errorText.trim()}`),
          );
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
      child.stdin.end(input);
    });
  }
}
