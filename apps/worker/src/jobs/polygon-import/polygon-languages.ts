import { PolygonImportError } from './polygon-import.error';
import { shown } from './polygon-package';

const CPP_DEFAULT_STANDARD = '17';
const CPP_STANDARDS = new Set(['11', '14', '17', '20', '23']);
/** `cpp.g++`, `cpp.g++17`, `cpp.gcc13-64-winlibs-g++20`: any g++ build, the standard being the trailing digits. */
const CPP_GPP_TYPE = /^cpp\..*g\+\+(\d*)$/;

/** Polygon source types that map to one judge language key; `cpp.*` is handled by its standard. */
const LANGUAGE_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^c\./, 'C11'],
  [/^java/, 'JAVA'],
  [/^kotlin/, 'KOTLIN'],
  [/^python\.3$/, 'PY3'],
  [/^python\.pypy3$/, 'PYPY3'],
  [/^(pascal|pas|delphi)/, 'PAS'],
];

function cppKeyOf(type: string): string | null {
  const standard = CPP_GPP_TYPE.exec(type)?.[1];
  if (standard === undefined) return null;
  const chosen = standard || CPP_DEFAULT_STANDARD;
  return CPP_STANDARDS.has(chosen) ? `CPP${chosen}` : null;
}

/** The judge language key of a Polygon source type; a type the judge cannot run is refused with the file it was declared for. */
export function languageKeyOf(type: string, path: string): string {
  const key =
    cppKeyOf(type) ??
    LANGUAGE_RULES.find(([pattern]) => pattern.test(type))?.[1];
  if (!key)
    throw new PolygonImportError(
      `unsupported language ${shown(type)} for ${shown(path)}`,
    );
  return key;
}
