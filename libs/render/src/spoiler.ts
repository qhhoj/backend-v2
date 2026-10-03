import type MarkdownIt from 'markdown-it';

const MAX_SPOILER_DEPTH = 20;
const OPEN_TAG = /^\s*<blockquote\s+class\s*=\s*(["'])spoiler\1\s*>\s*$/;
const CLOSE_TAG = /^\s*<\/blockquote>\s*$/;

interface SpoilerEnv {
  spoilerDepth?: number;
  /** `matchHtmlSpoilers` result per source string (nested parses have their own). */
  spoilerMatches?: Map<string, Map<number, number>>;
}

/** Parses `body` as Markdown inside a `<blockquote class="spoiler">`; the depth lives in `env` because the nested parse starts a fresh block level. */
function pushSpoiler(
  state: MarkdownIt.StateBlock,
  startLine: number,
  endLine: number,
  body: string,
): void {
  const env = state.env as SpoilerEnv;
  const open = state.push('spoiler_open', 'blockquote', 1);
  open.attrSet('class', 'spoiler');
  open.map = [startLine, endLine];
  env.spoilerDepth = (env.spoilerDepth ?? 0) + 1;
  try {
    state.md.block.parse(body, state.md, state.env, state.tokens);
  } finally {
    env.spoilerDepth--;
  }
  state.push('spoiler_close', 'blockquote', -1);
  state.line = endLine;
}

/** Consecutive lines starting with `>!`. */
function markedSpoiler(
  state: MarkdownIt.StateBlock,
  startLine: number,
  endLine: number,
  lineText: (line: number) => string,
): boolean {
  const marked = (line: number) =>
    state.sCount[line] - state.blkIndent < 4 && lineText(line).startsWith('>!');
  if (!marked(startLine)) return false;
  const lines: string[] = [];
  let line = startLine;
  for (; line < endLine && marked(line); line++)
    lines.push(lineText(line).slice(2).replace(/^ /, ''));
  pushSpoiler(state, startLine, line, lines.join('\n'));
  return true;
}

const FENCE = /^(`{3,}|~{3,})/;

/** Start line -> closing line of every `<blockquote class="spoiler">` pair in `state.src`, found in one pass; lines inside fenced code are skipped. */
function matchHtmlSpoilers(
  state: MarkdownIt.StateBlock,
  lineText: (line: number) => string,
): Map<number, number> {
  const matches = new Map<number, number>();
  const openLines: number[] = [];
  let fence = '';
  for (let line = 0; line < state.lineMax; line++) {
    const text = lineText(line);
    const marker = FENCE.exec(text)?.[1];
    if (fence) {
      if (marker?.startsWith(fence) && text.slice(marker.length).trim() === '')
        fence = '';
    } else if (marker) fence = marker;
    else if (OPEN_TAG.test(text)) openLines.push(line);
    else if (CLOSE_TAG.test(text) && openLines.length)
      matches.set(openLines.pop() as number, line);
  }
  return matches;
}

/** Legacy Polygon importer output: a `<blockquote class="spoiler">` line up to its matching `</blockquote>` line; an unclosed one is left to the HTML block rule. */
function htmlSpoiler(
  state: MarkdownIt.StateBlock,
  startLine: number,
  lineText: (line: number) => string,
): boolean {
  if (
    state.sCount[startLine] - state.blkIndent >= 4 ||
    !OPEN_TAG.test(lineText(startLine))
  )
    return false;
  const env = state.env as SpoilerEnv;
  env.spoilerMatches ??= new Map();
  let matches = env.spoilerMatches.get(state.src);
  if (!matches) {
    matches = matchHtmlSpoilers(state, lineText);
    env.spoilerMatches.set(state.src, matches);
  }
  const closeLine = matches.get(startLine);
  if (closeLine === undefined) return false;
  pushSpoiler(
    state,
    startLine,
    closeLine + 1,
    state.getLines(startLine + 1, closeLine, state.blkIndent, false),
  );
  return true;
}

/** Legacy `spoiler` blocks: `>!` lines (markdown2 extra) and raw `<blockquote class="spoiler">` HTML; past 20 levels they stay plain text/HTML. */
export function spoilerRule(
  state: MarkdownIt.StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean {
  if (((state.env as SpoilerEnv).spoilerDepth ?? 0) >= MAX_SPOILER_DEPTH)
    return false;
  const lineText = (line: number) =>
    state.src.slice(
      state.bMarks[line] + state.tShift[line],
      state.eMarks[line],
    );
  if (silent)
    return (
      state.sCount[startLine] - state.blkIndent < 4 &&
      (lineText(startLine).startsWith('>!') ||
        OPEN_TAG.test(lineText(startLine)))
    );
  return (
    markedSpoiler(state, startLine, endLine, lineText) ||
    htmlSpoiler(state, startLine, lineText)
  );
}
