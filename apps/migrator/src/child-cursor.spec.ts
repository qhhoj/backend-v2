import { Readable } from 'node:stream';
import { ChildCursor } from './child-cursor';

type Child = { parent: number; value: string };
const rows = (items: Child[]): AsyncIterable<Child> => Readable.from(items);

describe('ChildCursor', () => {
  const children: Child[] = [
    { parent: 1, value: 'a' },
    { parent: 1, value: 'b' },
    { parent: 2, value: 'c' },
    { parent: 4, value: 'd' },
    { parent: 9, value: 'orphan' },
  ];

  it('hands out the children of each parent batch, keeping a group whole across batches', async () => {
    const cursor = new ChildCursor(rows(children), 'parent');
    const first = await cursor.takeThrough(1);
    expect([...first.entries()]).toEqual([[1, [children[0], children[1]]]]);
    const second = await cursor.takeThrough(4);
    expect([...second.keys()]).toEqual([2, 4]);
    expect(await cursor.drain()).toBe(1);
  });

  it('returns an empty map when no child falls in the batch', async () => {
    const cursor = new ChildCursor(rows([{ parent: 7, value: 'x' }]), 'parent');
    expect((await cursor.takeThrough(3)).size).toBe(0);
    expect((await cursor.takeThrough(7)).get(7)).toHaveLength(1);
    expect(await cursor.drain()).toBe(0);
  });
});
