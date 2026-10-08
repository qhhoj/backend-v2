import {
  KNAPSACK,
  SIEVE,
  SIEVE_RENAMED,
  lineCount,
} from '../../../test/similarity-fixtures';
import { familyOf } from './similarity-languages';
import { SimilarityEngine, SimilarityEngineError } from './similarity-engine';
import type { EngineRequest } from './similarity-engine';

jest.setTimeout(60_000);

const cpp = familyOf('C++')!;
const pascal = familyOf('Pascal')!;
const request = (
  submissions: EngineRequest['submissions'],
  overrides: Partial<EngineRequest> = {},
): EngineRequest => ({
  family: cpp,
  submissions,
  minSimilarity: 0.5,
  maxPairs: 2000,
  timeoutMs: 50_000,
  ...overrides,
});

/** Exposes the running child so tests can look at the OS process. */
class InspectableEngine extends SimilarityEngine {
  childPid(): number | undefined {
    return this.activeChild?.pid;
  }
}

const isRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Enough files that the child is still busy a second after it started. */
const slowGroup = (): EngineRequest['submissions'] =>
  Array.from({ length: 300 }, (_unused, index) => ({
    id: `sub-${index}`,
    user: `user-${index}`,
    source: index % 2 ? SIEVE : SIEVE_RENAMED,
  }));

describe('SimilarityEngine', () => {
  const engine = new InspectableEngine();

  it('scores a copy with renamed variables high and an unrelated solution low', async () => {
    const pairs = await engine.compare(
      request(
        [
          { id: 'sub-1', user: 'ann', source: SIEVE },
          { id: 'sub-2', user: 'bob', source: SIEVE_RENAMED },
          { id: 'sub-3', user: 'cat', source: KNAPSACK },
        ],
        { minSimilarity: 0 },
      ),
    );
    const between = (left: string, right: string) =>
      pairs.find((pair) => pair.leftId === left && pair.rightId === right);
    expect(between('sub-1', 'sub-2')!.similarity).toBeGreaterThan(0.9);
    expect(between('sub-1', 'sub-3')!.similarity).toBeLessThan(0.2);
    expect(pairs[0]).toMatchObject({ leftId: 'sub-1', rightId: 'sub-2' });
  });

  it('drops pairs under the minimum similarity', async () => {
    const pairs = await engine.compare(
      request([
        { id: 'sub-1', user: 'ann', source: SIEVE },
        { id: 'sub-2', user: 'bob', source: SIEVE_RENAMED },
        { id: 'sub-3', user: 'cat', source: KNAPSACK },
      ]),
    );
    expect(pairs.map((pair) => `${pair.leftId}/${pair.rightId}`)).toEqual([
      'sub-1/sub-2',
    ]);
  });

  it('never pairs two submissions of the same user, even identical ones both copied by someone else', async () => {
    const pairs = await engine.compare(
      request([
        { id: 'sub-1', user: 'ann', source: SIEVE },
        { id: 'sub-2', user: 'ann', source: SIEVE },
        { id: 'sub-3', user: 'bob', source: SIEVE_RENAMED },
      ]),
    );
    const keys = pairs.map((pair) => `${pair.leftId}/${pair.rightId}`).sort();
    expect(keys).toEqual(['sub-1/sub-3', 'sub-2/sub-3']);
  });

  it('puts the lower submission id on the left whatever the input order, ranges following', async () => {
    const shifted = '// a\n'.repeat(5) + SIEVE_RENAMED;
    const [pair] = await engine.compare(
      request([
        { id: 'sub-9', user: 'ann', source: SIEVE },
        { id: 'sub-2', user: 'bob', source: shifted },
      ]),
    );
    expect([pair.leftId, pair.rightId]).toEqual(['sub-2', 'sub-9']);
    // The left side is the longer, shifted file: its matches run past the last line of the right one.
    for (const fragment of pair.fragments) {
      expect(fragment.leftEnd).toBeGreaterThan(lineCount(SIEVE));
      expect(fragment.leftEnd).toBeLessThanOrEqual(lineCount(shifted));
      expect(fragment.rightEnd).toBeLessThanOrEqual(lineCount(SIEVE));
    }
  });

  it('keeps only the most similar pairs', async () => {
    const pairs = await engine.compare(
      request(
        [
          { id: 'sub-1', user: 'ann', source: SIEVE },
          { id: 'sub-2', user: 'bob', source: SIEVE },
          { id: 'sub-3', user: 'cat', source: SIEVE },
          { id: 'sub-4', user: 'dan', source: KNAPSACK },
        ],
        { minSimilarity: 0, maxPairs: 3 },
      ),
    );
    expect(pairs).toHaveLength(3);
    expect(pairs.every((pair) => pair.similarity === 1)).toBe(true);
  });

  it('reports matched line ranges inside both sources', async () => {
    const [pair] = await engine.compare(
      request([
        { id: 'sub-1', user: 'ann', source: SIEVE },
        { id: 'sub-2', user: 'bob', source: SIEVE_RENAMED },
      ]),
    );
    expect(pair.fragments.length).toBeGreaterThan(0);
    for (const fragment of pair.fragments) {
      expect(fragment.leftStart).toBeGreaterThanOrEqual(1);
      expect(fragment.leftEnd).toBeLessThanOrEqual(lineCount(SIEVE));
      expect(fragment.rightEnd).toBeLessThanOrEqual(lineCount(SIEVE_RENAMED));
    }
    const widest = Math.max(
      ...pair.fragments.map(
        (fragment) => fragment.leftEnd - fragment.leftStart,
      ),
    );
    expect(widest).toBeGreaterThanOrEqual(10);
  });

  it('compares Pascal after dropping comments and case', async () => {
    const original =
      'program Sum;\nvar n, i: longint; total: int64; x: longint;\nbegin\n  readln(n); total := 0;\n  for i := 1 to n do begin read(x); total := total + x; end;\n  writeln(total);\nend.\n';
    const edited =
      '{ my solution }\nPROGRAM sum;\nVAR n, i: longint; total: int64; x: longint;\nBEGIN\n  readln(n); total := 0; // start\n  for i := 1 to n do begin read(x); total := total + x; end;\n  writeln(total);\nEND.\n';
    const pairs = await engine.compare(
      request(
        [
          { id: 'sub-1', user: 'ann', source: pascal.prepare(original) },
          { id: 'sub-2', user: 'bob', source: pascal.prepare(edited) },
        ],
        { family: pascal },
      ),
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0].similarity).toBeGreaterThan(0.8);
  });

  it('returns nothing for fewer than two submissions', async () => {
    expect(
      await engine.compare(
        request([{ id: 'sub-1', user: 'ann', source: SIEVE }]),
      ),
    ).toEqual([]);
  });

  it('kills the child at the deadline', async () => {
    const comparison = engine.compare(request(slowGroup(), { timeoutMs: 500 }));
    const pid = engine.childPid()!;
    await expect(comparison).rejects.toMatchObject({ code: 'deadline' });
    await sleep(300);
    expect(isRunning(pid)).toBe(false);
  });

  it('kills the child on application shutdown, failing the comparison', async () => {
    const comparison = engine.compare(request(slowGroup()));
    const pid = engine.childPid()!;
    engine.onApplicationShutdown();
    await expect(comparison).rejects.toMatchObject({ code: 'engine_failed' });
    await sleep(300);
    expect(isRunning(pid)).toBe(false);
  });

  it('reports engine_failed for a language the library cannot load', async () => {
    const failure = engine.compare(
      request(
        [
          { id: 'sub-1', user: 'ann', source: SIEVE },
          { id: 'sub-2', user: 'bob', source: SIEVE_RENAMED },
        ],
        { family: { ...cpp, language: 'no-such-language' } },
      ),
    );
    await expect(failure).rejects.toBeInstanceOf(SimilarityEngineError);
    await expect(failure).rejects.toMatchObject({ code: 'engine_failed' });
  });
});
