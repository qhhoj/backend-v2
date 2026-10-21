import { AppError } from '@libs/common';
import {
  PolygonClient,
  statementLanguagesOf,
  statementOptionsRefusal,
  testCountRefusal,
} from '@libs/problems';
import type { StatementOptions } from '@libs/problems';

/** The language options and the test count against what Polygon lists, so a choice the worker would refuse after the download fails now, with the worker's code (400, `params` as the job's `errorParams`). Polygon not answering skips the check: the worker checks the package anyway. */
export async function assertOptionsFit(
  polygon: PolygonClient,
  polygonId: number,
  options: StatementOptions & { maxCases: number },
): Promise<void> {
  const [statements, tests] = await Promise.all([
    polygon.statements(polygonId).catch(() => null),
    polygon.tests(polygonId).catch(() => null),
  ]);
  const refusal =
    (statements &&
      statementOptionsRefusal(statementLanguagesOf(statements), options)) ??
    (tests && testCountRefusal(tests.length, options.maxCases));
  if (refusal)
    throw new AppError(
      refusal.code,
      400,
      refusal.message,
      undefined,
      undefined,
      {
        params: refusal.params,
      },
    );
}
