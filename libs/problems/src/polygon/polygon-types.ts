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

/** A package as `problem.packages` returns it. */
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

/** The newest package (highest revision, then highest id): an import takes it only when it is READY, so a fix still building is never skipped for an older build. */
export function latestPackageOf(packages: PolygonPackageInfo[]): LatestPackage {
  const newest = [...packages].sort(
    (left, right) => right.revision - left.revision || right.id - left.id,
  )[0];
  if (!newest) return NO_PACKAGE;
  return {
    id: newest.id,
    revision: newest.revision,
    state: newest.state === 'PENDING' ? 'RUNNING' : newest.state,
    createdAt: new Date(newest.creationTimeSeconds * 1000).toISOString(),
  };
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
