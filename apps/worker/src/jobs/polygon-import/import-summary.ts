import type { ProblemData } from '@libs/database';
import type { ImportSummary } from '@libs/problems';
import type { PolygonAssets } from './polygon-assets';
import type { TestPlan } from './polygon-tests';

/** What the setter checks against Polygon after an import: the checker mapping, the counts and the clamped limits. */
export function importSummaryOf(
  assets: PolygonAssets,
  plan: TestPlan,
  data: Pick<ProblemData, 'cases'>,
): ImportSummary {
  const interactive = assets.grader === 'interactive';
  return {
    polygonChecker: assets.polygonChecker,
    checker: assets.checker,
    interactive,
    checkerIgnored: interactive && assets.polygonChecker !== null,
    tests: plan.tests.length,
    cases: data.cases.filter((row) => row.type === 'C').length,
    batches: data.cases.filter((row) => row.type === 'S').length,
    timeLimit: {
      polygon: plan.givenLimits.timeLimit,
      applied: plan.timeLimit,
    },
    memoryLimit: {
      polygon: plan.givenLimits.memoryLimit,
      applied: plan.memoryLimit,
    },
  };
}
