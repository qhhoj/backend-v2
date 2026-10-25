import { POLYGON_ERROR_CODES } from './polygon-api.error';

/**
 * Why a Polygon (or zip) import stopped, as a stable code the UI translates; `errorParams` carry what the text needs.
 * The Polygon API codes come first (the package download); `import_failed` is a failure not written for the requester.
 */
export const POLYGON_IMPORT_ERROR_CODES = [
  ...POLYGON_ERROR_CODES,
  'import_failed',
  /** problem.xml, the tests or the statements hold something the converter refuses; the error text says what. */
  'package_invalid',
  /** A full package lacks generated tests (the package was built without them). */
  'package_incomplete',
  /** Interactive problems and multi-file generators need a full package. */
  'package_needs_full',
  /** `{count, limit}`: the testset has more tests than the testcase limit. */
  'too_many_testcases',
  /** `{languages}`: several statements and no (or an unknown) main language. */
  'statement_language_required',
  /** `{language}`: a statement other than the main one has no site language (or `skip`). */
  'statement_language_unmapped',
  /** `{language}`: two statements map to one site language. */
  'statement_language_repeated',
  /** `{languages}`: several tutorials and no (or an unknown) tutorial language. */
  'tutorial_language_required',
  'checker_unsupported',
  /** `{runCount}`: the package runs the solution more than once per test (Polygon run-twice); QHHOJ grades one run, so the import is refused rather than misjudged. */
  'polygon_run_count_unsupported',
  'generation_failed',
  'generation_no_judge',
  'generation_timeout',
  /** `{usedBytes, limitBytes, neededBytes}`: the organization's storage cannot take the package. */
  'storage_full',
  /** `{what}` (`group` or `type`): the site has none to file a new problem under; an administrator adds one. */
  'catalog_missing',
  'problem_code_taken',
  'problem_not_found',
  /** Deleted, a mirror, manually managed, or its markup mode changed since the job was queued. */
  'problem_not_importable',
  /** Its test data or content changed while the job waited: a new import reads the new state. */
  'problem_changed',
  /** A sync of a problem unlinked (or linked elsewhere) after it was queued. */
  'problem_unlinked',
  /** `{until}`: an automatic sync waited a week for the contests using the problem to end; a manual sync applies the package. */
  'problem_in_running_contest',
  'polygon_already_linked',
  /** The requester lost a right the job needs (sync, full markup). */
  'requester_forbidden',
  /** `{step}`: the import committed, then a file step failed; the problem exists and a sync (or a data upload) repairs it. */
  'imported_needs_attention',
] as const;
export type PolygonImportErrorCode =
  (typeof POLYGON_IMPORT_ERROR_CODES)[number];
/** Values an error text interpolates; sizes in bytes, lists of Polygon language names. */
export type ImportErrorParams = Record<string, string | number | string[]>;

/** Failures the same request can get past later (Polygon or the judges come back, the problem stops changing): the UI offers "try again" only for these. */
export const RETRYABLE_IMPORT_ERRORS: ReadonlySet<PolygonImportErrorCode> =
  new Set(['polygon_unavailable', 'generation_no_judge', 'problem_changed']);
/** The subset the worker retries by itself once, a few minutes later: outages that pass without anyone acting. */
export const AUTO_RETRIED_IMPORT_ERRORS: ReadonlySet<PolygonImportErrorCode> =
  new Set(['polygon_unavailable', 'generation_no_judge']);
