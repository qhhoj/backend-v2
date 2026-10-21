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
  const percent =
    descendant(root, 'judging')?.attributes[
      'treat-points-from-checker-as-percent'
    ] === 'true';
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

/** Legacy `parse_assets`, with Polygon's model for an interactor: the problem checker still decides each case, reading what the interactor wrote (init.yml `interactive.checker`). An hcmp checker maps to `standard` there too. The returned paths come from problem.xml and are resolved by `PolygonPackage`, never used directly. */
export function parseAssets(root: XmlElement): PolygonAssets {
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
  };
}
