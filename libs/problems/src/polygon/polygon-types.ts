import type { PolygonPackageType } from '@libs/database';

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

/** One language of `problem.statements`; only the name and whether it has a tutorial are read. */
export interface PolygonStatement {
  name?: string;
  tutorial?: string;
}

/** What QHHOJ shows of a problem's newest package: PENDING reads as RUNNING, no package as NONE. */
export const PACKAGE_STATES = ['READY', 'RUNNING', 'FAILED', 'NONE'] as const;
export type PackageState = (typeof PACKAGE_STATES)[number];

export interface LatestPackage {
  id: number | null;
  revision: number | null;
  state: PackageState;
  /** `full` or `standard` once READY (what an import takes), null otherwise. */
  type: PolygonPackageType | null;
  /** When Polygon started building it, as an ISO string (it travels through Redis and job data as JSON). */
  createdAt: string | null;
}

/** A package an import can take: READY, with its id, revision and type. */
export type ReadyPackage = LatestPackage & {
  id: number;
  revision: number;
  type: PolygonPackageType;
};

const NO_PACKAGE: LatestPackage = {
  id: null,
  revision: null,
  state: 'NONE',
  type: null,
  createdAt: null,
};

/** The Polygon variant that holds every test with its answer; only a full package has it, and Polygon answers HTTP 500 when asked for it on a standard one. */
export const IMPORT_PACKAGE_TYPE = 'linux';
/** The variant every package has: manual tests, sources and `doall.sh`, without the generated tests. */
export const STANDARD_PACKAGE_VARIANT = 'standard';

/** The variant the worker downloads for a package type. */
export const variantOf = (type: PolygonPackageType): 'linux' | 'standard' =>
  type === 'full' ? IMPORT_PACKAGE_TYPE : STANDARD_PACKAGE_VARIANT;

const newestFirst = (left: PolygonPackageInfo, right: PolygonPackageInfo) =>
  right.revision - left.revision || right.id - left.id;

const isFull = (packages: PolygonPackageInfo[], id: number): boolean =>
  packages.some((row) => row.id === id && row.type === IMPORT_PACKAGE_TYPE);

const typeOf = (
  packages: PolygonPackageInfo[],
  row: PolygonPackageInfo,
): PolygonPackageType | null => {
  if (row.state !== 'READY') return null;
  return isFull(packages, row.id) ? 'full' : 'standard';
};

/** A READY full package of the revision wins over a standard one: it already holds the tests. */
const readyFullOfRevision = (
  packages: PolygonPackageInfo[],
  revision: number,
): PolygonPackageInfo | undefined =>
  packages
    .filter(
      (row) =>
        row.revision === revision &&
        row.state === 'READY' &&
        row.type === IMPORT_PACKAGE_TYPE,
    )
    .sort(newestFirst)[0];

/**
 * The newest package (highest revision, then highest id); a newer build still running or failed is never skipped for
 * an older one, so an import takes the result only when it is READY. Within a READY revision a full package is
 * preferred to a standard one, but an older revision's full package never beats a newer standard one (stale content).
 */
export function latestPackageOf(packages: PolygonPackageInfo[]): LatestPackage {
  const newest = [...packages].sort(newestFirst)[0];
  if (!newest) return NO_PACKAGE;
  const chosen =
    newest.state === 'READY'
      ? (readyFullOfRevision(packages, newest.revision) ?? newest)
      : newest;
  return {
    id: chosen.id,
    revision: chosen.revision,
    state: chosen.state === 'PENDING' ? 'RUNNING' : chosen.state,
    type: typeOf(packages, chosen),
    createdAt: new Date(chosen.creationTimeSeconds * 1000).toISOString(),
  };
}

/** The newest READY package of any kind (standard or full): every package records the link in its problem.xml. */
export function newestReadyPackageId(
  packages: PolygonPackageInfo[],
): number | null {
  return (
    packages.filter((row) => row.state === 'READY').sort(newestFirst)[0]?.id ??
    null
  );
}

/** Longest Polygon build comment passed on; a FAILED build's comment names the failing solution or test. */
const MAX_PACKAGE_COMMENT = 500;

/** Polygon's newest package as a setter sees it on Polygon: its state (PENDING reads as RUNNING) and Polygon's comment (why a build FAILED); null without a package. */
export interface NewestPackage {
  id: number;
  revision: number;
  state: Exclude<PackageState, 'NONE'>;
  comment: string | null;
}

export function newestPackageOf(
  packages: PolygonPackageInfo[],
): NewestPackage | null {
  const newest = [...packages].sort(newestFirst)[0];
  if (!newest) return null;
  return {
    id: newest.id,
    revision: newest.revision,
    state: newest.state === 'PENDING' ? 'RUNNING' : newest.state,
    comment: newest.comment?.trim().slice(0, MAX_PACKAGE_COMMENT) || null,
  };
}

/** Why `latestPackageOf` offers nothing READY, naming Polygon's newest package and its state. */
export function packageNotReadyReason(packages: PolygonPackageInfo[]): string {
  const newest = [...packages].sort(newestFirst)[0];
  if (!newest) return 'it has no package';
  return `its newest package ${newest.id} (revision ${newest.revision}) is ${newest.state}`;
}

/** The statement languages of a problem as `problem.statements` lists them, with their title and whether a tutorial (the editorial) comes with them; sorted by language name. */
export function statementLanguagesOf(
  statements: Record<string, PolygonStatement>,
): Array<{ language: string; title: string | null; hasTutorial: boolean }> {
  return Object.entries(statements)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([language, statement]) => ({
      language,
      title: statement.name?.trim() || null,
      hasTutorial: Boolean(statement.tutorial?.trim()),
    }));
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
