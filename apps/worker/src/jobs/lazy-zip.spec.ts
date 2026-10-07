import { chunkedSources } from './lazy-zip';

describe('chunkedSources', () => {
  it('reads each position from its id and fetches one chunk per query', async () => {
    const queries: string[][] = [];
    const sources = chunkedSources(['a', 'b', 'c', 'd', 'e'], 2, (ids) => {
      queries.push(ids);
      return Promise.resolve(
        new Map(
          ids.filter((id) => id !== 'c').map((id) => [id, id.toUpperCase()]),
        ),
      );
    });
    const read: string[] = [];
    for (const position of [0, 1, 2, 3, 4]) read.push(await sources(position));
    expect(read).toEqual(['A', 'B', '', 'D', 'E']);
    expect(queries).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
  });
});
