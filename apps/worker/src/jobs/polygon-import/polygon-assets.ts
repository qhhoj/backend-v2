import type {
  Checker,
  CustomCheckerType,
  Grader,
  JsonObject,
} from '@libs/database';
import { PolygonImportError } from './polygon-import.error';
import { childOf, descendant } from '@libs/problems';
import type { XmlElement } from '@libs/problems';

export interface PolygonAssets {
  grader: Grader;
  checker: Checker;
  checkerArgs: JsonObject | null;
  /** Package path of the checker source (bridged only). */
  checkerSource: string | null;
  /** The package's checker as Polygon names it (`std::wcmp.cpp`), or its source path; null when it has none. */
  polygonChecker: string | null;
  interactorSource: string | null;
  /** The interactive grader's arguments: the percent flag for the interactor's points; null otherwise. */
  graderArgs: JsonObject | null;
}

type CheckerAssets = Pick<
  PolygonAssets,
  'checker' | 'checkerArgs' | 'checkerSource'
>;

const polygonCheckerOf = (checker: XmlElement | null): string | null =>
  checker?.attributes.name ??
  (checker && childOf(checker, 'source')?.attributes.path) ??
  null;

/** testlib's hcmp reads one integer token, which the judge's `standard` compares the same way. Every other `std::*` checker compares token streams across lines (or, lcmp, all-or-nothing per line), which no built-in matches, so it runs from the package's own testlib source like a custom one. */
const STANDARD_EQUIVALENT = 'std::hcmp.cpp';
const STANDARD_CHECKER: CheckerAssets = {
  checker: 'standard',
  checkerArgs: null,
  checkerSource: null,
};
/** Polygon's problem-wide "treat points from checker as percent": a testlib `quitp(x)` is x% of the test, for the checker and the interactor alike. */
export const pointsArePercent = (root: XmlElement): boolean =>
  descendant(root, 'judging')?.attributes[
    'treat-points-from-checker-as-percent'
  ] === 'true';

/** Polygon checkers are testlib programs; typed so a rename of the known custom checker types fails to compile. */
const POLYGON_CHECKER_TYPE: CustomCheckerType = 'testlib';

const sourcePath = (
  element: XmlElement,
  what: string,
  message: string,
): string => {
  const path = childOf(element, 'source')?.attributes.path;
  if (!path)
    throw new PolygonImportError(
      `${what} source not found`,
      'checker_unsupported',
    );
  if (!path.toLowerCase().endsWith('.cpp'))
    throw new PolygonImportError(message, 'checker_unsupported');
  return path;
};

/** hcmp maps to `standard`; any other testlib checker is a problem-wide bridged C++ checker (per-case rows never carry `bridged`). */
function parseChecker(root: XmlElement, checker: XmlElement): CheckerAssets {
  if (checker.attributes.type !== 'testlib')
    throw new PolygonImportError(
      'not a testlib checker',
      'checker_unsupported',
    );
  if (checker.attributes.name === STANDARD_EQUIVALENT) return STANDARD_CHECKER;
  const percent = pointsArePercent(root);
  return {
    checker: 'bridged',
    checkerArgs: {
      type: POLYGON_CHECKER_TYPE,
      lang: 'CPP17',
      ...(percent ? { treat_checker_points_as_percentage: true } : {}),
    },
    checkerSource: sourcePath(checker, 'checker', 'checker must use C++'),
  };
}

/** Polygon's `<judging run-count>`: how many times the solution runs per test. Absent means one (packages from before the attribute). */
const SINGLE_RUN = '1';

/** A run-twice package would import as a one-run problem and be misjudged, so any count but one is refused. */
function assertSingleRun(root: XmlElement): void {
  const runCount = descendant(root, 'judging')?.attributes['run-count'];
  if (runCount === undefined || runCount.trim() === SINGLE_RUN) return;
  throw new PolygonImportError(
    `the package runs the solution ${runCount} times per test; QHHOJ grades one run`,
    'polygon_run_count_unsupported',
    { runCount },
  );
}

/** Legacy `parse_assets`, with Polygon's model for an interactor: the problem checker still decides each case, reading what the interactor wrote (init.yml `interactive.checker`). An hcmp checker maps to `standard` there too. The returned paths come from problem.xml and are resolved by `PolygonPackage`, never used directly. A package that runs the solution more than once per test is refused first (`assertSingleRun`). */
export function parseAssets(root: XmlElement): PolygonAssets {
  assertSingleRun(root);
  const checker = descendant(root, 'checker');
  if (!checker)
    throw new PolygonImportError('checker not found', 'checker_unsupported');
  const interactor = descendant(root, 'interactor');
  return {
    grader: interactor ? 'interactive' : 'standard',
    ...parseChecker(root, checker),
    polygonChecker: polygonCheckerOf(checker),
    interactorSource: interactor
      ? sourcePath(interactor, 'interactor', 'interactor must use C++')
      : null,
    graderArgs:
      interactor && pointsArePercent(root)
        ? { treat_checker_points_as_percentage: true }
        : null,
  };
}
