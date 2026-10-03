import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderMarkdown } from './markdown';

const FIXTURES = join(__dirname, 'fixtures');
const names = readdirSync(FIXTURES)
  .filter((file) => file.endsWith('.md'))
  .map((file) => file.slice(0, -'.md'.length));

/** `UPDATE_GOLDENS=1 npx jest libs/render/src/goldens.spec.ts` rewrites the .html files; review the diff before committing. */
describe('render goldens (problem style)', () => {
  it.each(names)('%s renders like its golden', (name) => {
    const html = renderMarkdown(
      readFileSync(join(FIXTURES, `${name}.md`), 'utf8'),
      'problem',
    );
    const goldenPath = join(FIXTURES, `${name}.html`);
    if (process.env.UPDATE_GOLDENS === '1') writeFileSync(goldenPath, html);
    expect(html).toBe(readFileSync(goldenPath, 'utf8'));
  });
});
