import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readZip } from '../../test/read-zip';
import { chunkedSources, writeLazyZip } from './lazy-zip';

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

describe('writeLazyZip', () => {
  let directory: string;
  let path: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'qhhoj-data-zip-'));
    path = join(directory, 'out.zip');
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it('streams every entry, fetching sources lazily one at a time', async () => {
    let inFlight = 0;
    let peak = 0;
    const sourceAt = async (index: number) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      inFlight -= 1;
      return `source ${index}`;
    };
    await writeLazyZip(['a/x.cpp', 'b/x.cpp'], sourceAt, {
      path,
      maxBytes: 1024,
      tooLarge: () => new Error('too large'),
    });
    expect(await readZip(path)).toEqual({
      'a/x.cpp': 'source 0',
      'b/x.cpp': 'source 1',
    });
    expect(peak).toBe(1);
  });

  it('aborts at the byte cap', async () => {
    await expect(
      writeLazyZip(
        ['a/x.cpp', 'a/y.cpp'],
        () => Promise.resolve('x'.repeat(600)),
        {
          path,
          maxBytes: 1000,
          tooLarge: () => new Error('too large'),
        },
      ),
    ).rejects.toThrow('too large');
  });
});
