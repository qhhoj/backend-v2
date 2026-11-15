import { renderMarkdown } from './markdown';

describe('compact headings', () => {
  it('keeps the old site `##Input` heading in a statement', () => {
    expect(renderMarkdown('##Input', 'problem')).toContain('<h4>Input</h4>');
  });

  it('does not turn a preprocessor line into a heading in a statement', () => {
    expect(renderMarkdown('#define X 1', 'problem')).not.toMatch(/<h\d/);
  });

  it('does not turn pasted code into a heading in a comment or blog post', () => {
    for (const style of ['user', 'blog'] as const) {
      expect(renderMarkdown('#include<bits/stdc++.h>', style)).not.toMatch(
        /<h\d/,
      );
    }
  });

  it('keeps `# Title` with a space a heading in every style', () => {
    expect(renderMarkdown('# Title', 'user')).toContain('<h3>Title</h3>');
  });
});
