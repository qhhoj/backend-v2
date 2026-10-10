/** A fence marker (3+ backticks or tildes) after up to 3 spaces of indent. */
const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;

export type FenceLine = 'open' | 'close' | 'inside' | 'outside';

/** Whether `rest` (the text after a backtick marker) is a valid info string: CommonMark refuses backticks in it. */
const isOpener = (marker: string, rest: string) =>
  marker[0] !== '`' || !rest.includes('`');

/** Each line's place relative to fenced code blocks: the opening and closing marker lines, the code between them, or ordinary text. An unclosed fence runs to the end. */
export function classifyFenceLines(lines: readonly string[]): FenceLine[] {
  let fence = '';
  return lines.map((text) => {
    const match = FENCE.exec(text);
    if (fence) {
      if (match?.[2].startsWith(fence) && match[3].trim() === '') {
        fence = '';
        return 'close';
      }
      return 'inside';
    }
    if (match && isOpener(match[2], match[3])) {
      fence = match[2];
      return 'open';
    }
    return 'outside';
  });
}

/**
 * Legacy statements put fenced code straight after an HTML line (`<summary>…</summary>` then ```` ```c++ ````); the old site
 * found fences before it looked at HTML, so the code was highlighted. A blank line before each column-0 opening fence ends the HTML
 * block there; everywhere else such a fence already starts a new block, so the blank line changes nothing.
 */
export function separateFencesFromHtml(text: string): string {
  const lines = text.split('\n');
  const kinds = classifyFenceLines(lines);
  const separated: string[] = [];
  lines.forEach((line, index) => {
    const previous = lines[index - 1];
    if (
      kinds[index] === 'open' &&
      /^[`~]/.test(line) &&
      previous !== undefined &&
      previous.trim() !== ''
    )
      separated.push('');
    separated.push(line);
  });
  return separated.join('\n');
}
