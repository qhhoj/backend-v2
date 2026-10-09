import { newId } from '@libs/database';
import type { GhostInput } from '@libs/contests';
import { GhostsRepository } from '../src/modules/contests/ghosts/ghosts.repository';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

describe('ghost store', () => {
  let api: ApiTest;
  let ghosts: GhostsRepository;
  const problemId = newId();
  const ghost = (label: string, minute: number): GhostInput => ({
    label,
    caption: 'School',
    cells: [{ problemId, minute, rejectedBefore: 1, points: null }],
  });

  beforeAll(async () => {
    api = await setupApiTest();
    ghosts = api.app.get(GhostsRepository);
  });
  afterAll(() => api.teardown());

  it("returns a contest's ghosts by label with plain string ids", async () => {
    const contest = newId();
    await ghosts.replaceAll(contest, [ghost('Bob', 30), ghost('Ann', 12)]);
    const found = await ghosts.findByContest(contest);
    expect(found.map((row) => row.label)).toEqual(['Ann', 'Bob']);
    expect(found[0].cells[0]).toEqual({
      problemId,
      minute: 12,
      rejectedBefore: 1,
      points: null,
    });
  });

  it('replaces the whole set, and keeps the old one when the new set is invalid', async () => {
    const contest = newId();
    await ghosts.replaceAll(contest, [ghost('Ann', 12)]);
    await expect(
      ghosts.replaceAll(contest, [ghost('Cy', 5), ghost('Cy', 6)]),
    ).rejects.toThrow(/duplicate key/);
    expect(
      (await ghosts.findByContest(contest)).map((row) => row.label),
    ).toEqual(['Ann']);
    await ghosts.replaceAll(contest, [ghost('Dee', 9)]);
    expect(
      (await ghosts.findByContest(contest)).map((row) => row.label),
    ).toEqual(['Dee']);
  });

  it("removes only the given contest's ghosts and reports how many", async () => {
    const [mine, other] = [newId(), newId()];
    await ghosts.replaceAll(mine, [ghost('Ann', 1), ghost('Bob', 2)]);
    await ghosts.replaceAll(other, [ghost('Ann', 1)]);
    expect(await ghosts.removeAll(mine)).toBe(2);
    expect(await ghosts.findByContest(mine)).toEqual([]);
    expect(await ghosts.findByContest(other)).toHaveLength(1);
  });
});
