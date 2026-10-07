import { batchFiles } from './contest-moss.service';

describe('batchFiles', () => {
  const source = (username: string, size: number) => ({
    submissionId: 'id',
    username,
    source: 'x'.repeat(size),
  });
  const HEADER = '// http://site/submission/id\n'.length;

  it('skips a file that no longer fits and still takes smaller ones after it', () => {
    const files = batchFiles(
      [source('first', 10), source('huge', 100), source('small', 10)],
      'http://site',
      2 * (HEADER + 10),
    );
    expect(files.map((file) => file.name)).toEqual(['first', 'small']);
  });

  it('names files after the username with unsafe characters replaced', () => {
    expect(
      batchFiles([source('a b/é', 1)], 'http://site').map((file) => file.name),
    ).toEqual(['a_b__']);
  });
});
