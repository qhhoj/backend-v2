import type { ProblemTestCase } from '@libs/database';
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

describe('importSummaryOf', () => {
  it('counts distinct tests, judged cases and batches, and maps the checker', () => {
    expect(
      importSummaryOf(assets(), plan(), {
        cases: rows('C', 'S', 'C', 'C', 'E', 'S', 'C', 'C', 'E'),
      }),
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
      { cases: rows('C') },
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
        { cases: rows('C') },
      ),
    ).toMatchObject({
      interactive: true,
      checker: 'standard',
      polygonChecker: 'std::wcmp.cpp',
      checkerIgnored: true,
    });
  });
});
