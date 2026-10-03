import type MarkdownIt from 'markdown-it';

const DASHES: ReadonlyArray<[string, string]> = [
  ['---', '—'],
  ['--', '–'],
  ['...', '…'],
];

/** The smartypants substitutions beyond quotes; markdown-it's own `replacements` rule is disabled because it also rewrites (c), (tm) and +-. */
export function dashesRule(state: MarkdownIt.StateCore): void {
  for (const block of state.tokens) {
    if (block.type !== 'inline' || !block.children) continue;
    for (const child of block.children)
      if (child.type === 'text')
        for (const [source, dash] of DASHES)
          child.content = child.content.replaceAll(source, dash);
  }
}
