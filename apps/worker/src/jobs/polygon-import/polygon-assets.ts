import type {
  Checker,
  CustomCheckerType,
  Grader,
  JsonObject,
} from '@libs/database';
import { PolygonImportError } from './polygon-import.error';
import { childOf, descendant } from './polygon-xml';
import type { XmlElement } from './polygon-xml';

export interface PolygonAssets {
  grader: Grader;
  checker: Checker;
  checkerArgs: JsonObject | null;
  /** Package path of the custom checker source (bridged only). */
  checkerSource: string | null;
  interactorSource: string | null;
}

const STANDARD_CHECKERS = new Set([
  'std::hcmp.cpp',
  'std::ncmp.cpp',
  'std::wcmp.cpp',
]);
const FLOATS_CHECKER = /^std::rcmp([469])\.cpp$/;
/** Polygon checkers are testlib programs; typed so a rename of the known custom checker types fails to compile. */
const POLYGON_CHECKER_TYPE: CustomCheckerType = 'testlib';

const sourcePath = (
  element: XmlElement,
  what: string,
  message: string,
): string => {
  const path = childOf(element, 'source')?.attributes.path;
  if (!path) throw new PolygonImportError(`${what} source not found`);
  if (!path.toLowerCase().endsWith('.cpp'))
    throw new PolygonImportError(message);
  return path;
};

/** Legacy `parse_assets`: an interactor wins (its checker is ignored); otherwise testlib's standard checkers map to DMOJ ones and anything else is a problem-wide bridged C++ checker (per-case rows never carry `bridged`). The returned paths come from problem.xml and are resolved by `PolygonPackage`, never used directly. */
export function parseAssets(root: XmlElement): PolygonAssets {
  const interactor = descendant(root, 'interactor');
  if (interactor)
    return {
      grader: 'interactive',
      checker: 'standard',
      checkerArgs: null,
      checkerSource: null,
      interactorSource: sourcePath(
        interactor,
        'interactor',
        'interactor must use C++',
      ),
    };
  const checker = descendant(root, 'checker');
  if (!checker) throw new PolygonImportError('checker not found');
  if (checker.attributes.type !== 'testlib')
    throw new PolygonImportError('not a testlib checker');
  const standard = {
    grader: 'standard' as const,
    checkerSource: null,
    interactorSource: null,
  };
  const name = checker.attributes.name;
  if (name && STANDARD_CHECKERS.has(name))
    return { ...standard, checker: 'standard', checkerArgs: null };
  const floats = name && FLOATS_CHECKER.exec(name);
  if (floats)
    return {
      ...standard,
      checker: 'floats',
      checkerArgs: { precision: Number(floats[1]) },
    };
  if (name === 'std::fcmp.cpp')
    return { ...standard, checker: 'identical', checkerArgs: null };
  if (name === 'std::lcmp.cpp')
    return { ...standard, checker: 'linecount', checkerArgs: null };
  const percent =
    descendant(root, 'judging')?.attributes[
      'treat-points-from-checker-as-percent'
    ] === 'true';
  return {
    ...standard,
    checker: 'bridged',
    checkerArgs: {
      type: POLYGON_CHECKER_TYPE,
      lang: 'CPP17',
      ...(percent ? { treat_checker_points_as_percentage: true } : {}),
    },
    checkerSource: sourcePath(checker, 'checker', 'checker must use C++'),
  };
}
