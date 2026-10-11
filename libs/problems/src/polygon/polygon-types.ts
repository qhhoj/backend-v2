/** A problem as `problems.list` returns it. `latestPackage` is the newest revision that has a package, absent when none. */
export interface PolygonProblem {
  id: number;
  owner: string;
  name: string;
  deleted?: boolean;
  accessType?: 'READ' | 'WRITE' | 'OWNER';
  revision: number;
  latestPackage?: number;
  modified?: boolean;
}

/**
 * One row of `problem.packages`. A full package is listed once per variant (`standard`, `linux`, `windows`) under
 * one id; a standard package is listed once, as `standard`.
 */
export interface PolygonPackageInfo {
  id: number;
  revision: number;
  creationTimeSeconds: number;
  state: 'PENDING' | 'RUNNING' | 'READY' | 'FAILED';
  comment?: string;
  type?: string;
}

/** One language of `problem.statements`; only the name is read. */
export interface PolygonStatement {
  name?: string;
}

/** What QHHOJ shows of a problem's newest package: PENDING reads as RUNNING, no package as NONE. */
export const PACKAGE_STATES = ['READY', 'RUNNING', 'FAILED', 'NONE'] as const;
export type PackageState = (typeof PACKAGE_STATES)[number];

export interface LatestPackage {
  id: number | null;
  revision: number | null;
  state: PackageState;
  /** When Polygon started building it, as an ISO string (it travels through Redis and job data as JSON). */
  createdAt: string | null;
}

const NO_PACKAGE: LatestPackage = {
  id: null,
  revision: null,
  state: 'NONE',
  createdAt: null,
};

/**
 * The variant the worker downloads. Only a full package has it, and only it holds every test with its answer: a
 * standard package's zip lacks the generated tests, and Polygon answers HTTP 500 when asked for its `linux` variant.
 */
export const IMPORT_PACKAGE_TYPE = 'linux';

const newestFirst = (left: PolygonPackageInfo, right: PolygonPackageInfo) =>
  right.revision - left.revision || right.id - left.id;

const isFull = (packages: PolygonPackageInfo[], id: number): boolean =>
  packages.some((row) => row.id === id && row.type === IMPORT_PACKAGE_TYPE);

/**
 * The newest package an import can take (highest revision, then highest id). A READY package without the Linux
 * variant is skipped, as it cannot be imported; a newer build still running or failed is never skipped for an older
 * one, so an import takes the result only when it is READY.
 */
export function latestPackageOf(packages: PolygonPackageInfo[]): LatestPackage {
  const newest = packages
    .filter((row) => row.state !== 'READY' || isFull(packages, row.id))
    .sort(newestFirst)[0];
  if (!newest) return NO_PACKAGE;
  return {
    id: newest.id,
    revision: newest.revision,
    state: newest.state === 'PENDING' ? 'RUNNING' : newest.state,
    createdAt: new Date(newest.creationTimeSeconds * 1000).toISOString(),
  };
}

/** Why `latestPackageOf` offers nothing READY, naming Polygon's newest package, its state and whether it is full. */
export function packageNotReadyReason(packages: PolygonPackageInfo[]): string {
  const newest = [...packages].sort(newestFirst)[0];
  if (!newest) return 'it has no package';
  const name = `package ${newest.id} (revision ${newest.revision})`;
  if (newest.state === 'READY' && !isFull(packages, newest.id))
    return `its newest ${name} is a READY standard package, without the generated tests`;
  return `its newest ${name} is ${newest.state}`;
}
/** Vietnamese first, then English, then any language; null when no statement has a name. */
export function statementTitleOf(
  statements: Record<string, PolygonStatement>,
): string | null {
  const named = (language: string) => statements[language]?.name?.trim();
  const preferred = ['vietnamese', 'english', ...Object.keys(statements)];
  for (const language of preferred) {
    const name = named(language);
    if (name) return name;
  }
  return null;
}
