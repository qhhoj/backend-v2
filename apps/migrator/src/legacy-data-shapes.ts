import { extensionOf } from '@libs/problems';

export interface ShapeRow {
  code: string;
  data?: {
    checker?: string | null;
    customChecker?: string | null;
    cases?: { input?: string | null; output?: string | null }[];
  } | null;
}

export interface DataShapeCounts {
  /** Bridged (custom) checkers by source extension. */
  bridged: Record<string, number>;
  /** Codes of bridged checkers judge-v2 cannot compile today: only testlib.h (C++) is vendored. */
  bridgedNeedingTestlib: string[];
  /** Codes with a case file named inside an archive subdirectory (`tests/1.in`). */
  nestedCaseNames: string[];
}

const TESTLIB_MISSING = new Set(['pas', 'java']);

const isNested = (name?: string | null) => Boolean(name && name.includes('/'));

function countOne(row: ShapeRow, counts: DataShapeCounts): void {
  const data = row.data ?? {};
  if (data.checker === 'bridged' && data.customChecker) {
    const extension = extensionOf(data.customChecker);
    counts.bridged[extension] = (counts.bridged[extension] ?? 0) + 1;
    if (TESTLIB_MISSING.has(extension))
      counts.bridgedNeedingTestlib.push(row.code);
  }
  if (
    (data.cases ?? []).some(
      (testCase) => isNested(testCase.input) || isNested(testCase.output),
    )
  )
    counts.nestedCaseNames.push(row.code);
}

/** Pre-window facts about migrated problem data that the parity seed cannot show (judge-v2 cutover). */
export async function countDataShapes(
  problems: AsyncIterable<ShapeRow> | Iterable<ShapeRow>,
): Promise<DataShapeCounts> {
  const counts: DataShapeCounts = {
    bridged: {},
    bridgedNeedingTestlib: [],
    nestedCaseNames: [],
  };
  for await (const row of problems) countOne(row, counts);
  return counts;
}
