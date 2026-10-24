import { createHash } from 'node:crypto';
import {
  DATA_FILE_KINDS,
  emptyProblemData,
  BASE_STATEMENT_LANGUAGE,
  STATEMENT_LANGUAGES,
  uuidStr,
} from '@libs/database';
import type {
  DataFileKind,
  Problem,
  ProblemTestCase,
  StatementLanguage,
} from '@libs/database';
import { safeFileName } from './file-names';

const PACKAGE_FORMAT = 'qhhoj-package';
const PACKAGE_FORMAT_VERSION = 1;

export interface PackageStatement {
  language: StatementLanguage;
  name: string;
  text: string;
  /** Path inside the zip. */
  file: string;
}

export interface PackageManifest {
  format: typeof PACKAGE_FORMAT;
  formatVersion: typeof PACKAGE_FORMAT_VERSION;
  problem: {
    code: string;
    name: string;
    source: string;
    points: number;
    partial: boolean;
    timeLimit: number;
    memoryLimit: number;
    isFullMarkup: boolean;
    allowedLanguages: string[];
    languageLimits: Array<{
      languageId: string;
      timeLimit: number;
      memoryLimit: number;
    }>;
  };
  statements: Array<{
    language: StatementLanguage;
    name: string;
    file: string;
  }>;
  data: {
    checker: string;
    checkerArgs: unknown;
    grader: string;
    graderArgs: unknown;
    outputPrefix: number | null;
    outputLimit: number | null;
    unicode: boolean;
    nobigmath: boolean;
    /** An interactive problem also runs its checker on what the interactor wrote. */
    interactiveChecker: boolean;
    /** Stored names; the files sit in `data/` (archive) and `sources/` (the rest). */
    files: Record<DataFileKind, string | null>;
    /** Headers the checker and interactor compile with, in `sources/`. */
    helperHeaders: string[];
    cases: ProblemTestCase[];
  };
  /** Name inside `material/`. */
  material: string | null;
  /** `statements/uploaded.pdf` when the editor uploaded a PDF statement. */
  uploadedStatement: string | null;
}

const plain = <Value>(value: Value): Value =>
  JSON.parse(JSON.stringify(value)) as Value;

/** The one name of the uploaded material: the manifest states it and the zip entry uses it, so the two cannot differ. */
export const materialName = (url: string | null): string | null =>
  url ? safeFileName(url.split('/').pop() ?? '') : null;

type Statements = Pick<Problem, 'name' | 'description' | 'translations'>;

/** The base statement (Vietnamese), then each translation; a translation in the base language replaces the base. */
export function packageStatements(problem: Statements): PackageStatement[] {
  const byLanguage = new Map<StatementLanguage, { name: string; text: string }>(
    [
      [
        BASE_STATEMENT_LANGUAGE,
        { name: problem.name, text: problem.description },
      ],
    ],
  );
  for (const translation of problem.translations)
    byLanguage.set(translation.language, {
      name: translation.name,
      text: translation.description,
    });
  return STATEMENT_LANGUAGES.filter((language) => byLanguage.has(language)).map(
    (language) => ({
      language,
      file: `statements/${language}.md`,
      ...byLanguage.get(language)!,
    }),
  );
}

function problemSection(problem: Problem): PackageManifest['problem'] {
  return {
    code: problem.code,
    name: problem.name,
    source: problem.source ?? '',
    points: problem.points,
    partial: problem.partial,
    timeLimit: problem.timeLimit,
    memoryLimit: problem.memoryLimit,
    isFullMarkup: problem.isFullMarkup,
    allowedLanguages: problem.allowedLanguages.map(uuidStr),
    languageLimits: problem.languageLimits.map((limit) => ({
      languageId: uuidStr(limit.languageId),
      timeLimit: limit.timeLimit,
      memoryLimit: limit.memoryLimit,
    })),
  };
}

function dataSection(problem: Problem): PackageManifest['data'] {
  const data = problem.data ?? emptyProblemData();
  return {
    checker: data.checker,
    checkerArgs: plain(data.checkerArgs),
    grader: data.grader,
    graderArgs: plain(data.graderArgs),
    outputPrefix: data.outputPrefix,
    outputLimit: data.outputLimit,
    unicode: data.unicode,
    nobigmath: data.nobigmath,
    interactiveChecker: data.interactiveChecker ?? false,
    files: Object.fromEntries(
      DATA_FILE_KINDS.map((kind) => [kind, data[kind]]),
    ) as Record<DataFileKind, string | null>,
    helperHeaders: [...(data.helperHeaders ?? [])],
    cases: plain(data.cases),
  };
}

/** Three small sections (problem fields, data settings, statements and uploads) instead of one long assembly. */
export function buildManifest(problem: Problem): PackageManifest {
  return {
    format: PACKAGE_FORMAT,
    formatVersion: PACKAGE_FORMAT_VERSION,
    problem: problemSection(problem),
    statements: packageStatements(problem).map(({ language, name, file }) => ({
      language,
      name,
      file,
    })),
    data: dataSection(problem),
    material: materialName(problem.materialUrl),
    uploadedStatement: problem.pdfStatementUrl ? 'uploaded.pdf' : null,
  };
}

/** `<dataVersion>.<hash>`: the hash covers the manifest, every statement text and the two upload URLs. A re-uploaded PDF gets a new URL (`pdf/<newId>.pdf`), so the URL moves the key; a same-named material keeps its URL, so `ProblemUploadsService.replaceFile` also drops the problem's cached packages. A build already running during an upload can still write one stale zip under the old key until the next request: accepted. */
export function packageKey(problem: Problem): string {
  const content = JSON.stringify([
    buildManifest(problem),
    packageStatements(problem).map((statement) => statement.text),
    problem.pdfStatementUrl ?? null,
    problem.materialUrl ?? null,
  ]);
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 12);
  return `${problem.dataVersion ?? 0}.${hash}`;
}
