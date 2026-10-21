import type { ImportSummary } from '@libs/problems';
import type { SyncedValues } from './local-edits';
import type { PolygonAssets } from './polygon-assets';
import type { TestPlan } from './polygon-tests';

/** What the setter checks against Polygon after an import: the checker mapping, the counts and the limits as stored (clamped, or kept by a sync). */
export function importSummaryOf(
  assets: PolygonAssets,
  plan: TestPlan,
  stored: SyncedValues,
): ImportSummary {
  const { data } = stored;
  const interactive = assets.grader === 'interactive';
  return {
    polygonChecker: assets.polygonChecker,
    checker: data.checker,
    interactive,
    checkerIgnored: interactive && assets.polygonChecker !== null,
    tests: plan.tests.length,
    cases: data.cases.filter((row) => row.type === 'C').length,
    batches: data.cases.filter((row) => row.type === 'S').length,
    timeLimit: {
      polygon: plan.givenLimits.timeLimit,
      applied: stored.timeLimit,
    },
    memoryLimit: {
      polygon: plan.givenLimits.memoryLimit,
      applied: stored.memoryLimit,
    },
  };
}
