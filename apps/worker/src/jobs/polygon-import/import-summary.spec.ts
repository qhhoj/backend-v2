import { emptyProblemData } from '@libs/database';
import type { Checker, ProblemTestCase } from '@libs/database';
import { importSummaryOf } from './import-summary';
import type { PolygonAssets } from './polygon-assets';
import type { TestPlan } from './polygon-tests';

const assets = (overrides: Partial<PolygonAssets> = {}): PolygonAssets => ({
  grader: 'standard',
  checker: 'bridged',
  checkerArgs: null,
  checkerSource: 'files/check.cpp',
  polygonChecker: 'std::wcmp.cpp',
  interactorSource: null,
  ...overrides,
});
const plan = (overrides: Partial<TestPlan> = {}): TestPlan =>
  ({
    timeLimit: 1,
    memoryLimit: 262144,
    givenLimits: { timeLimit: 1, memoryLimit: 262144 },
    partial: false,
    tests: [{}, {}, {}],
    cases: [],
    graderArgs: null,
    ...overrides,
  }) as TestPlan;
const rows = (...types: Array<'C' | 'S' | 'E'>) =>
  types.map((type) => ({ type }) as ProblemTestCase);
/** What the import wrote: the plan's limits and the package's checker unless a test says otherwise. */
const stored = (
  cases: ProblemTestCase[],
  {
    timeLimit = 1,
    memoryLimit = 262144,
    checker = 'bridged',
  }: { timeLimit?: number; memoryLimit?: number; checker?: Checker } = {},
) => ({
  timeLimit,
  memoryLimit,
  partial: false,
  data: { ...emptyProblemData(), checker, cases },
});

describe('importSummaryOf', () => {
  it('counts distinct tests, judged cases and batches, and maps the checker', () => {
    expect(
      importSummaryOf(
        assets(),
        plan(),
        stored(rows('C', 'S', 'C', 'C', 'E', 'S', 'C', 'C', 'E')),
      ),
    ).toEqual({
      polygonChecker: 'std::wcmp.cpp',
      checker: 'bridged',
      interactive: false,
      checkerIgnored: false,
      tests: 3,
      cases: 5,
      batches: 2,
      timeLimit: { polygon: 1, applied: 1 },
      memoryLimit: { polygon: 262144, applied: 262144 },
    });
  });

  it('shows the limits Polygon gave beside the clamped ones', () => {
    const summary = importSummaryOf(
      assets(),
      plan({
        timeLimit: 60,
        memoryLimit: 1048576,
        givenLimits: { timeLimit: 90, memoryLimit: 2097152 },
      }),
      stored(rows('C'), { timeLimit: 60, memoryLimit: 1048576 }),
    );
    expect(summary.timeLimit).toEqual({ polygon: 90, applied: 60 });
    expect(summary.memoryLimit).toEqual({ polygon: 2097152, applied: 1048576 });
  });

  it('marks the checker of an interactive problem as not run', () => {
    expect(
      importSummaryOf(
        assets({
          grader: 'interactive',
          checker: 'standard',
          checkerSource: null,
          interactorSource: 'files/interactor.cpp',
        }),
        plan(),
        stored(rows('C'), { checker: 'standard' }),
      ),
    ).toMatchObject({
      interactive: true,
      checker: 'standard',
      polygonChecker: 'std::wcmp.cpp',
      checkerIgnored: true,
    });
  });

  it('shows the limit and checker a sync kept, beside what Polygon gave', () => {
    const summary = importSummaryOf(
      assets(),
      plan({
        timeLimit: 3,
        givenLimits: { timeLimit: 3, memoryLimit: 262144 },
      }),
      stored(rows('C'), { timeLimit: 4, checker: 'standard' }),
    );
    expect(summary.timeLimit).toEqual({ polygon: 3, applied: 4 });
    expect(summary).toMatchObject({
      polygonChecker: 'std::wcmp.cpp',
      checker: 'standard',
    });
  });
});
