import { readFileSync } from 'node:fs';
import { KATEX_CLASSES } from './katex-classes';

describe('KATEX_CLASSES', () => {
  it('lists every class selector of the installed KaTeX stylesheet', () => {
    const css = readFileSync(
      require.resolve('katex/dist/katex.css'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '');
    const selectors = [...css.matchAll(/([^{}]+)\{/g)]
      .map((match) => match[1])
      .filter((selector) => !selector.trim().startsWith('@'));
    const classes = new Set(
      selectors.flatMap((selector) =>
        [...selector.matchAll(/\.([A-Za-z][\w-]*)/g)].map((match) => match[1]),
      ),
    );
    expect([...KATEX_CLASSES].sort()).toEqual([...classes].sort());
  });
});
